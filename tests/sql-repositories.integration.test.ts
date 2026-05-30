declare const process: { env: Record<string, string | undefined>; exitCode?: number };
declare const require: (name: string) => unknown;

import { runInitialRestaurantPosMigration } from '../backend/db/migrations';
import { clearRepositoryStore } from '../backend/db/repositoryStore';
import { closeDatabasePool, query, withTransaction } from '../backend/db/client';
import { createTable, closeTableSession, openTableSession } from '../backend/tables/service';
import { saveUser } from '../backend/users/repository';
import type { AuthenticatedUser } from '../backend/auth/policies';
import { createInventoryMasterItem, listInventoryWithBalances } from '../backend/inventory/service';
import { adminCreateCategory, adminCreateItem } from '../backend/menu/service';
import { createOrderDraft, transitionOrderStatus } from '../backend/orders/service';
import { generateBillFromSessionItems, recordSplitPayment } from '../backend/billing/service';
import { listAuditEvents } from '../backend/audit/repository';
import type { TableOrderItem } from '../backend/billing/repository';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function canLoadPg(): Promise<boolean> {
  try {
    require('pg');
    return true;
  } catch {
    return false;
  }
}

async function runSqlRepositoryIntegration(): Promise<void> {
  if (!process.env.DB_HOST && !process.env.PGHOST) {
    console.warn('Skipping SQL repository integration test because DB_HOST/PGHOST is not configured.');
    return;
  }
  if (!(await canLoadPg())) {
    console.warn('Skipping SQL repository integration test because the pg package is not installed.');
    return;
  }

  process.env.POS_REPOSITORY_BACKEND = 'postgres';
  process.env.DB_CLIENT = process.env.DB_CLIENT ?? 'postgres';
  process.env.DB_HOST = process.env.DB_HOST ?? process.env.PGHOST;
  process.env.DB_PORT = process.env.DB_PORT ?? process.env.PGPORT ?? '5432';
  process.env.DB_NAME = process.env.DB_NAME ?? process.env.PGDATABASE;
  process.env.DB_USER = process.env.DB_USER ?? process.env.PGUSER;
  process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? '';
  process.env.DB_SSL = process.env.DB_SSL ?? 'false';

  await runInitialRestaurantPosMigration();
  await clearRepositoryStore();

  const branchId = 'sql-main';
  const waiter: AuthenticatedUser = { id: 'waiter-sql', branchId, role: 'waitstaff', status: 'active' };
  const kitchen: AuthenticatedUser = { id: 'kitchen-sql', branchId, role: 'kitchen', status: 'active' };
  const cashier: AuthenticatedUser = { id: 'cashier-sql', branchId, role: 'cashier', status: 'active' };
  await Promise.all([saveUser(waiter), saveUser(kitchen), saveUser(cashier)]);

  const rice = await createInventoryMasterItem({ branchId, sku: 'RICE-SQL', name: 'SQL Rice', unit: 'portion', minimumThreshold: 1, currentStock: 6 });
  const category = await adminCreateCategory({ branchId, name: 'SQL Specials', sortOrder: 1 });
  const menuItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'SQL Tea Rice', price: 10, isAvailable: true });

  const table = await createTable({ id: 'SQL-T1', branchId, name: 'SQL Table 1', capacity: 2 });
  const tableSession = await openTableSession(cashier, { tableId: table.id, guestCount: 2, branchId });

  let order = await createOrderDraft(waiter, {
    branchId,
    serviceMode: 'dine_in',
    tableSessionId: tableSession.id,
    items: [{ menuItemId: rice.id, name: menuItem.name, station: 'kitchen', quantity: 2, unitPrice: menuItem.price }],
  });

  await assertVersionConflict(order.id, order.version + 99, waiter);
  order = await transitionOrderStatus(waiter, order.id, order.version, 'in_preparation');
  const inventory = await listInventoryWithBalances();
  assert(inventory.find((item) => item.id === rice.id)?.currentBalance === 4, 'SQL stock deduction should be committed with the status transition.');

  const billLines: TableOrderItem[] = order.items.map((item) => ({
    id: item.id,
    branchId,
    orderId: order.id,
    tableSessionId: order.tableSessionId!,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
  }));
  order = await transitionOrderStatus(kitchen, order.id, order.version, 'completed');
  order = await transitionOrderStatus(waiter, order.id, order.version, 'delivered');
  const bill = await generateBillFromSessionItems(tableSession.id, { A: billLines }, cashier.id, { taxMode: 'taxable', taxRate: 0 }, branchId);
  await recordSplitPayment({ tableSessionId: tableSession.id, splitLabel: 'A', amount: bill.calculationBreakdown.totalDue, method: 'cash', actorUserId: cashier.id });

  await closeTableSession(cashier, tableSession.id);

  const auditRows = await listAuditEvents({ query: order.id, limit: 20 });
  assert(auditRows.some((row) => row.action === 'stock_adjusted'), 'SQL audit store should include the stock adjustment audit event.');

  await withTransaction(async () => {
    await query('SELECT 1');
  });
}

async function assertVersionConflict(orderId: string, badVersion: number, waiter: AuthenticatedUser): Promise<void> {
  try {
    await transitionOrderStatus(waiter, orderId, badVersion, 'in_preparation');
  } catch (error) {
    assert(String(error).includes('Version conflict detected'), 'Expected SQL optimistic concurrency conflict.');
    return;
  }
  throw new Error('Expected SQL optimistic concurrency conflict.');
}

runSqlRepositoryIntegration()
  .then(async () => {
    await closeDatabasePool();
    console.log('SQL repository integration flow completed.');
  })
  .catch(async (error) => {
    console.error(error);
    await closeDatabasePool();
    process.exitCode = 1;
  });
