declare const process: { env: Record<string, string | undefined>; exitCode?: number };
declare const require: (name: string) => unknown;

import { runInitialRestaurantPosMigration, INITIAL_MIGRATION_ID } from '../backend/db/migrations';
import { clearRepositoryStore } from '../backend/db/repositoryStore';
import { closeDatabasePool, query, withTransaction } from '../backend/db/client';
import { hashPassword } from '../backend/auth/service';
import { saveUser } from '../backend/users/repository';
import { createInventoryMasterItem, listInventoryWithBalances } from '../backend/inventory/service';
import { createTable, getTableSession, openTableSession } from '../backend/tables/service';
import type { AuthenticatedUser } from '../backend/auth/policies';
import { assert, assertEqual } from './helpers/assertions';
import { getPosOperationalSettings, initializePosOperationalSettings, savePosOperationalSettings, updatePosOperationalSettings } from '../backend/config/posSettings';
import { getDeductionTriggerPolicy, initializeInventorySettings, setDeductionTriggerPolicy } from '../backend/inventory/service';

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
  assert(migration.rows[0]?.exists === true, 'Initial SYM POS SQL migration should be recorded as applied.');
  const menuMigration = await query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE id = $1) AS exists',
    ['20260923100000_bidirectional_menu'],
  );
  assert(menuMigration.rows[0]?.exists === true, 'Bidirectional menu migration should succeed and be recorded as applied.');
  await clearRepositoryStore();

  await withTransaction(async (client) => {
    await client.query("SELECT set_config('restaurant_pos.app_mode', 'POS', true), set_config('restaurant_pos.store_id', 'configured-store', true)");
    await client.query('TRUNCATE sync_outbox');

    await client.query(
      `INSERT INTO repository_records(namespace, record_key, payload)
       VALUES ('menu:categories', 'category-1', '{"branchId":"payload-store","name":"Lunch"}'::jsonb)`,
    );
    let outbox = await client.query<{ entity_type: string; store_id: string }>('SELECT entity_type, store_id FROM sync_outbox');
    assertEqual(outbox.rowCount, 1, 'A menu category insert should queue exactly one sync event.');
    assertEqual(outbox.rows[0]?.entity_type, 'menu_categories', 'A menu category should use the category entity type.');
    assertEqual(outbox.rows[0]?.store_id, 'payload-store', 'Payload branchId should take precedence during store resolution.');

    await client.query('TRUNCATE sync_outbox');
    await client.query(
      `INSERT INTO repository_records(namespace, record_key, payload)
       VALUES ('menu:items', 'item-1', '{"name":"Soup"}'::jsonb)`,
    );
    outbox = await client.query('SELECT entity_type, store_id FROM sync_outbox');
    assertEqual(outbox.rowCount, 1, 'A menu item insert should queue exactly one sync event.');

    await client.query('TRUNCATE sync_outbox');
    await client.query(`UPDATE repository_records SET payload = payload || '{"name":"Tomato Soup"}'::jsonb WHERE namespace = 'menu:items' AND record_key = 'item-1'`);
    outbox = await client.query('SELECT event_id FROM sync_outbox');
    assertEqual(outbox.rowCount, 1, 'A menu update should queue exactly one sync event.');

    await client.query('TRUNCATE sync_outbox');
    await client.query(`DELETE FROM repository_records WHERE namespace = 'menu:items' AND record_key = 'item-1'`);
    const deleteOutbox = await client.query<{ entity_id: string; operation: string; payload: { name: string } }>(
      'SELECT entity_id, operation, payload FROM sync_outbox',
    );
    assertEqual(deleteOutbox.rowCount, 1, 'A menu delete should complete and queue exactly one sync event.');
    assertEqual(deleteOutbox.rows[0]?.entity_id, 'item-1', 'A menu delete should queue the OLD record key.');
    assertEqual(deleteOutbox.rows[0]?.operation, 'DELETE', 'A menu delete should queue a delete operation.');
    assertEqual(deleteOutbox.rows[0]?.payload.name, 'Tomato Soup', 'A menu delete should queue the OLD payload.');

    await client.query('TRUNCATE sync_outbox');
    await client.query(`INSERT INTO repository_records(namespace, record_key, payload) VALUES ('settings:pos', 'main', '{}'::jsonb)`);
    outbox = await client.query('SELECT event_id FROM sync_outbox');
    assertEqual(outbox.rowCount, 0, 'An unrelated repository namespace should not queue a menu sync event.');

    await client.query("SELECT set_config('restaurant_pos.sync_origin', 'CLOUD_MANAGER', true)");
    await client.query(`INSERT INTO repository_records(namespace, record_key, payload) VALUES ('menu:items', 'cloud-item', '{}'::jsonb)`);
    outbox = await client.query('SELECT event_id FROM sync_outbox');
    assertEqual(outbox.rowCount, 0, 'A cloud-manager-origin menu change should not queue an outbound echo event.');

    const duplicateTriggers = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_trigger
       WHERE NOT tgisinternal AND tgname IN ('menu_categories_sync_outbox', 'menu_items_sync_outbox')`,
    );
    assertEqual(duplicateTriggers.rows[0]?.count, '0', 'Duplicate base menu table sync triggers should remain removed.');
  });

  await savePosOperationalSettings({
    prepStations: [
      { id: 'kitchen', displayName: 'Kitchen', enabled: true, sortOrder: 10 },
      { id: 'deployment-station', displayName: 'Deployment station', enabled: true, sortOrder: 20 },
    ],
    printers: {
      receipt: {
        enabled: true,
        printerId: 'persistent-receipt-printer',
        displayName: 'Persistent receipt printer',
        connectionType: 'network',
        networkAddress: '192.0.2.25',
        networkPort: 9100,
        copies: 2,
        autoPrint: false,
      },
    },
  });
  updatePosOperationalSettings({
    prepStations: [{ id: 'kitchen', displayName: 'Kitchen', enabled: true, sortOrder: 10 }],
    printers: { receipt: { printerId: 'temporary-printer', networkAddress: '127.0.0.1' } },
  });
  await initializePosOperationalSettings(true);
  assert(
    getPosOperationalSettings().prepStations.some((station) => station.id === 'deployment-station'),
    'Prep station settings should reload from PostgreSQL after an application restart.',
  );
  assertEqual(getPosOperationalSettings().printers.receipt.printerId, 'persistent-receipt-printer', 'Printer settings should reload from PostgreSQL after an application restart.');
  assertEqual(getPosOperationalSettings().printers.receipt.networkAddress, '192.0.2.25', 'Printer connection configuration should persist in PostgreSQL.');

  const settingsManager: AuthenticatedUser = { id: 'settings-manager', branchId: 'main', role: 'manager', status: 'active' };
  await setDeductionTriggerPolicy(settingsManager, 'manual');
  const storedInventorySettings = await query<{ payload: { deductionTriggerPolicy: string } }>(
    `SELECT payload FROM repository_records WHERE namespace = 'settings:inventory' AND record_key = $1`,
    ['main'],
  );
  assertEqual(storedInventorySettings.rows[0]?.payload.deductionTriggerPolicy, 'manual', 'Inventory configuration should be stored in PostgreSQL.');
  await initializeInventorySettings(true);
  assertEqual(getDeductionTriggerPolicy(), 'manual', 'Inventory configuration should reload from PostgreSQL.');

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
