declare const process: { exitCode?: number };

import { AdminAuditApi } from '../backend/audit/controller';
import type { AuthenticatedUser } from '../backend/auth/policies';
import { recordSplitPayment } from '../backend/billing/service';
import { createInventoryMasterItem, listInventoryWithBalances } from '../backend/inventory/service';
import { getKdsSnapshot, updateKdsItemProgress } from '../backend/kds/service';
import { adminCreateCategory, adminCreateItem } from '../backend/menu/service';
import { createOrderDraft, editOrderBeforePayment, transitionOrderStatus } from '../backend/orders/service';
import { getFinancialSummaryReport, getInventoryUsageReport, getSalesReport } from '../backend/reports/service';
import { createTable, closeTableSession, openTableSession } from '../backend/tables/service';
import { saveUser } from '../backend/users/repository';
import { loadAdminAuditViewer } from '../frontend/admin/audit-viewer';
import { loadAdminInventoryAlerts } from '../frontend/admin/inventory-alerts';
import { loadAdminMenuDashboard } from '../frontend/admin/menu-management';
import { openBillingScreen, startBillForBillingScreen } from '../frontend/billing/billing-screen';
import { loadKitchenQueue } from '../frontend/kds/kitchen-screen';
import { loadOrderForScreen } from '../frontend/orders/order-screen';
import type { TableOrderItem } from '../backend/billing/repository';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
}

async function assertRejects(action: () => Promise<unknown>, expectedMessage: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(String(error).includes(expectedMessage), `Expected rejection containing "${expectedMessage}".`);
    return;
  }
  throw new Error(`Expected rejection containing "${expectedMessage}".`);
}

async function runEndToEndPosFlow(): Promise<void> {
  const branchId = 'main';
  const manager: AuthenticatedUser = { id: 'mgr-e2e', branchId, role: 'manager', status: 'active' };
  const waiter: AuthenticatedUser = { id: 'waiter-e2e', branchId, role: 'waitstaff', status: 'active' };
  const kitchen: AuthenticatedUser = { id: 'kitchen-e2e', branchId, role: 'kitchen', status: 'active' };
  const cashier: AuthenticatedUser = { id: 'cashier-e2e', branchId, role: 'cashier', status: 'active' };
  await Promise.all([saveUser(manager), saveUser(waiter), saveUser(kitchen), saveUser(cashier)]);

  const rice = await createInventoryMasterItem({ branchId, sku: 'RICE-E2E', name: 'Rice portions', unit: 'portion', minimumThreshold: 5, currentStock: 20 });
  const category = await adminCreateCategory({ branchId, name: 'E2E Specials', sortOrder: 1 });
  const menuItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Tea Leaf Rice', price: 7.5, isAvailable: true });
  assert(menuItem.isAvailable, 'Menu item should be available for order entry.');

  const table = await createTable({ id: 'T-E2E-01', branchId, name: 'Table E2E 01', capacity: 4 });
  const tableSession = await openTableSession(cashier, { tableId: table.id, guestCount: 4, branchId });
  await assertRejects(() => openTableSession(cashier, { tableId: table.id, guestCount: 2, branchId }), 'active session already exists');

  let order = await createOrderDraft(waiter, {
    branchId,
    serviceMode: 'dine_in',
    tableSessionId: tableSession.id,
    items: [{ menuItemId: rice.id, name: menuItem.name, station: 'kitchen', quantity: 2, unitPrice: menuItem.price, note: 'Less oil' }],
  });
  assertEqual(order.subtotal, 15, 'Order subtotal should reflect seeded cart items');
  await assertRejects(() => closeTableSession(cashier, tableSession.id), 'Cannot close table session while order');

  order = await editOrderBeforePayment(waiter, order.id, {
    expectedVersion: order.version,
    modifyItems: [{ id: order.items[0].id, quantity: 3 }],
    reason: 'Guest added one more portion',
  });
  assertEqual(order.subtotal, 22.5, 'Edited order subtotal should be recalculated');

  order = await transitionOrderStatus(waiter, order.id, order.version, 'in_preparation');
  const inventoryAfterPrep = await listInventoryWithBalances();
  const riceBalance = inventoryAfterPrep.find((item) => item.id === rice.id)?.currentBalance;
  assertEqual(riceBalance, 17, 'Inventory should auto-deduct when the order enters preparation');

  const kitchenQueue = await getKdsSnapshot('kitchen');
  const kitchenTicket = kitchenQueue.groups.flatMap((group) => group.items).find((item) => item.orderId === order.id);
  assert(kitchenTicket, 'KDS should receive the order item for kitchen preparation.');
  await updateKdsItemProgress(kitchen, order.id, kitchenTicket.orderItemId, 'ready');
  order = await transitionOrderStatus(kitchen, order.id, order.version, 'completed');
  order = await transitionOrderStatus(waiter, order.id, order.version, 'delivered');
  assertEqual(order.status, 'delivered', 'Order should complete the service workflow');

  const billLines: TableOrderItem[] = order.items.map((item) => ({
    id: item.id,
    branchId,
    orderId: order.id,
    tableSessionId: order.tableSessionId!,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    itemDiscount: 1,
    comboDiscount: 0.5,
  }));
  const billingVm = await startBillForBillingScreen({
    tableSessionId: order.tableSessionId!,
    itemsBySplit: { A: billLines },
    actorUserId: cashier.id,
    pricing: { taxMode: 'taxable', taxRate: 5, billPromotions: [{ id: 'promo-e2e', name: 'Manager comp', type: 'fixed_amount', value: 2 }] },
    locale: 'my-MM',
  });
  assertEqual(billingVm.calculationBreakdown.totalDue, 19.95, 'Bill should apply item, combo, bill discount, and tax in order');
  await recordSplitPayment({ tableSessionId: tableSession.id, splitLabel: 'A', amount: billingVm.calculationBreakdown.totalDue, method: 'cash', actorUserId: cashier.id });
  const paidBillingVm = await openBillingScreen(tableSession.id, 'my-MM');
  const closedSession = await closeTableSession(cashier, tableSession.id);
  assertEqual(closedSession.status, 'closed', 'Table session should close after orders and bills are complete');
  assertEqual(paidBillingVm.receiptPreview.balanceDue, 0, 'Receipt preview should show no balance after full payment');

  const [salesReport, inventoryReport, financialReport] = await Promise.all([
    getSalesReport(manager, 'day', { branchId }),
    getInventoryUsageReport(manager, { branchId }),
    getFinancialSummaryReport(manager, { branchId }),
  ]);
  assert(salesReport.summary.orderCount >= 1, 'Sales report should include the completed order.');
  assert(inventoryReport.summary.totalUsed >= 3, 'Inventory report should include sale deduction usage.');
  assert(financialReport.summary.revenue >= paidBillingVm.calculationBreakdown.totalDue, 'Financial summary should include bill revenue.');

  const [orderScreen, menuDashboard, kitchenScreen, inventoryAlerts, auditViewer] = await Promise.all([
    loadOrderForScreen(order.id, 'en-US'),
    loadAdminMenuDashboard('en-US'),
    loadKitchenQueue('en-US'),
    loadAdminInventoryAlerts('en-US'),
    loadAdminAuditViewer(manager, { query: order.id, limit: 10, locale: 'en-US' }),
  ]);
  assert(orderScreen.order?.id === order.id, 'Order frontend view model should load the service order.');
  assert(menuDashboard.categories.some((row) => row.id === category.id), 'Menu admin frontend should include configured category.');
  assert(kitchenScreen.queue.groups.length > 0, 'Kitchen frontend should expose station groups.');
  assert(inventoryAlerts.alerts.every((alert) => alert.currentBalance <= alert.minimumThreshold), 'Inventory alerts should only contain threshold breaches.');

  const auditSearch = await AdminAuditApi.search(manager, { query: order.id, limit: 20 });
  assert(auditSearch.events.some((event) => event.action === 'order_edited'), 'Audit API should expose order edit audit records.');
  assert(auditViewer.rows.length >= 1, 'Audit frontend should render query results.');
}

runEndToEndPosFlow()
  .then(() => {
    console.log('E2E POS flow completed successfully.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
