declare const process: { env: Record<string, string | undefined>; exitCode?: number };
declare const require: (name: string) => unknown;

import { runInitialRestaurantPosMigration, INITIAL_MIGRATION_ID } from '../backend/db/migrations';
import { clearRepositoryStore } from '../backend/db/repositoryStore';
import { closeDatabasePool, query } from '../backend/db/client';
import { hashPassword } from '../backend/auth/service';
import { saveUser } from '../backend/users/repository';
import { createInventoryMasterItem, listInventoryWithBalances } from '../backend/inventory/service';
import { createTable, getTableSession, openTableSession } from '../backend/tables/service';
import type { AuthenticatedUser } from '../backend/auth/policies';
import { assert, assertEqual } from './helpers/assertions';

async function canLoadPg(): Promise<boolean> {
  try {
    require('pg');
    return true;
  } catch {
    return false;
  }
}

function configurePostgresRepository(): boolean {
  if (!process.env.DB_HOST && !process.env.PGHOST) return false;
  process.env.POS_REPOSITORY_BACKEND = 'postgres';
  process.env.DB_CLIENT = process.env.DB_CLIENT ?? 'postgres';
  process.env.DB_HOST = process.env.DB_HOST ?? process.env.PGHOST;
  process.env.DB_PORT = process.env.DB_PORT ?? process.env.PGPORT ?? '5432';
  process.env.DB_NAME = process.env.DB_NAME ?? process.env.PGDATABASE;
  process.env.DB_USER = process.env.DB_USER ?? process.env.PGUSER;
  process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? '';
  process.env.DB_SSL = process.env.DB_SSL ?? 'false';
  return true;
}

async function runDatabasePersistenceE2e(): Promise<void> {
  if (!configurePostgresRepository()) {
    console.warn('Skipping database persistence E2E test because DB_HOST/PGHOST is not configured.');
    return;
  }
  if (!(await canLoadPg())) {
    console.warn('Skipping database persistence E2E test because the pg package is not installed.');
    return;
  }

  await runInitialRestaurantPosMigration();
  const migration = await query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE id = $1) AS exists', [INITIAL_MIGRATION_ID]);
  assert(migration.rows[0]?.exists === true, 'Initial RestaurantPOS SQL migration should be recorded as applied.');
  await clearRepositoryStore();

  const branchId = 'db-e2e-main';
  const cashier: AuthenticatedUser = { id: 'cashier-db-e2e', branchId, role: 'cashier', status: 'active' };
  await saveUser({ ...cashier, username: 'cashier-db-e2e', passwordHash: hashPassword('correct-horse-db') });
  const rice = await createInventoryMasterItem({ branchId, sku: 'RICE-DB-E2E', name: 'DB E2E Rice', unit: 'portion', minimumThreshold: 1, currentStock: 7 });
  const table = await createTable({ id: 'DB-E2E-T1', branchId, name: 'DB E2E Table 1', capacity: 2 });
  const session = await openTableSession(cashier, { tableId: table.id, guestCount: 2, branchId });

  await closeDatabasePool();

  const reloadedSession = await getTableSession(session.id);
  const reloadedBalances = await listInventoryWithBalances();
  assert(reloadedSession?.id === session.id, 'Open table session should persist across a database pool restart.');
  assertEqual(reloadedBalances.find((item) => item.id === rice.id)?.currentBalance, 7, 'Inventory balance should persist across a database pool restart.');

  await closeDatabasePool();
  const secondReload = await getTableSession(session.id);
  assert(secondReload?.status === 'open', 'Persisted table session should still be open after a second simulated process restart.');
}

runDatabasePersistenceE2e()
  .then(async () => {
    await closeDatabasePool();
    console.log('Database-backed persistence E2E flow completed.');
  })
  .catch(async (error) => {
    console.error(error);
    await closeDatabasePool();
    process.exitCode = 1;
  });
