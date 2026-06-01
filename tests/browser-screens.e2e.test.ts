declare const process: { exitCode?: number };

import type { AuthenticatedUser } from '../backend/auth/policies';
import { Actions, RolePermissions } from '../backend/auth/permissions';
import { saveUser } from '../backend/users/repository';
import { createInventoryMasterItem, saveMenuInventoryRecipe } from '../backend/inventory/service';
import { adminCreateCategory, adminCreateItem } from '../backend/menu/service';
import { createTable, openTableSession } from '../backend/tables/service';
import { appRoutes, canAccessRoute, visibleRoutes } from '../frontend/auth/navigation';
import { loadCashierTableFloor } from '../frontend/cashier/table-floor';
import { startDineInOrder, advanceOrderStatus, loadOrderForScreen } from '../frontend/orders/order-screen';
import { loadKitchenQueue, setKitchenItemProgress } from '../frontend/kds/kitchen-screen';
import { loadBarQueue } from '../frontend/kds/bar-screen';
import { closePaidTableFromBillingScreen, startBillForBillingScreen, openBillingScreen } from '../frontend/billing/billing-screen';
import { loadAdminMenuDashboard } from '../frontend/admin/menu-management';
import { loadAdminInventoryAlerts } from '../frontend/admin/inventory-alerts';
import { loadAdminAuditViewer } from '../frontend/admin/audit-viewer';
import { recordSplitPayment } from '../backend/billing/service';
import type { TableOrderItem } from '../backend/billing/repository';
import { assert } from './helpers/assertions';

function permissionsFor(role: string): string[] {
  return RolePermissions[role] ?? [];
}

async function runBrowserScreenE2e(): Promise<void> {
  const branchId = 'main';
  const manager: AuthenticatedUser = { id: 'manager-browser', branchId, role: 'manager', status: 'active' };
  const waiter: AuthenticatedUser = { id: 'waiter-browser', branchId, role: 'waitstaff', status: 'active' };
  const kitchen: AuthenticatedUser = { id: 'kitchen-browser', branchId, role: 'kitchen', status: 'active' };
  const bar: AuthenticatedUser = { id: 'bar-browser', branchId, role: 'bar', status: 'active' };
  const cashier: AuthenticatedUser = { id: 'cashier-browser', branchId, role: 'cashier', status: 'active' };
  await Promise.all([saveUser(manager), saveUser(waiter), saveUser(kitchen), saveUser(bar), saveUser(cashier)]);

  const rice = await createInventoryMasterItem({ branchId, sku: 'RICE-BROWSER', name: 'Browser Rice', unit: 'portion', minimumThreshold: 1, currentStock: 20 });
  const syrup = await createInventoryMasterItem({ branchId, sku: 'SYRUP-BROWSER', name: 'Browser Syrup', unit: 'pour', minimumThreshold: 1, currentStock: 20 });
  const category = await adminCreateCategory({ branchId, name: 'Browser Specials', sortOrder: 1 });
  const kitchenItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Browser Tea Rice', price: 8, prepStation: 'kitchen', isAvailable: true });
  const barItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Browser Lime Soda', price: 4, prepStation: 'bar', isAvailable: true });
  await saveMenuInventoryRecipe({ branchId, menuItemId: kitchenItem.id, inventoryItemId: rice.id, quantityPerUnit: 1 });
  await saveMenuInventoryRecipe({ branchId, menuItemId: barItem.id, inventoryItemId: syrup.id, quantityPerUnit: 1 });

  const table = await createTable({ id: 'BROWSER-T1', branchId, name: 'Browser Table 1', capacity: 4 });
  const tableSession = await openTableSession(cashier, { tableId: table.id, guestCount: 3, branchId });
  let order = await startDineInOrder(waiter, tableSession.id, [
    { menuItemId: kitchenItem.id, quantity: 1 },
    { menuItemId: barItem.id, quantity: 1 },
  ]);
  order = await advanceOrderStatus(waiter, order.id, order.version, 'in_preparation');

  const cashierRoutes = visibleRoutes(permissionsFor('cashier') as any);
  assert(cashierRoutes.some((route) => route.path === '#/tables'), 'Cashier browser navigation should expose the table floor route.');
  assert(cashierRoutes.some((route) => route.path === '#/billing'), 'Cashier browser navigation should expose billing route.');
  assert(!canAccessRoute(appRoutes.find((route) => route.path === '#/audit')!, permissionsFor('cashier') as any), 'Cashier browser navigation should hide audit route.');
  assert(canAccessRoute(appRoutes.find((route) => route.path === '#/audit')!, permissionsFor('manager') as any), 'Manager browser navigation should expose audit route.');

  const tableFloor = await loadCashierTableFloor(branchId, 'en');
  assert(tableFloor.tables.some((row) => row.table.id === table.id && row.status === 'occupied'), 'Cashier table-floor screen should render the occupied session.');

  const orderScreen = await loadOrderForScreen(order.id, 'en');
  assert(orderScreen.order?.id === order.id, 'Cashier/order browser screen should load the order.');

  const kitchenQueue = await loadKitchenQueue('en');
  const kitchenTicket = kitchenQueue.queue.groups.flatMap((group) => group.items).find((item) => item.orderId === order.id);
  assert(kitchenTicket, 'Kitchen browser screen should render kitchen KDS items.');
  await setKitchenItemProgress(kitchen, order.id, kitchenTicket.orderItemId, 'ready');
  const refreshedKitchenQueue = await loadKitchenQueue('en');
  assert(!refreshedKitchenQueue.queue.groups.flatMap((group) => group.items).some((item) => item.orderId === order.id), 'Ready kitchen KDS item should leave the active tab.');
  assert(refreshedKitchenQueue.history.groups.flatMap((group) => group.items).some((item) => item.orderId === order.id), 'Ready kitchen KDS item should appear in the history tab.');

  const barQueue = await loadBarQueue('en');
  assert(barQueue.queue.groups.some((group) => group.station === 'bar' && group.items.some((item) => item.orderId === order.id)), 'Bar browser screen should render bar KDS items.');

  const billLines: TableOrderItem[] = order.items.map((item) => ({ ...item, orderId: order.id, tableSessionId: tableSession.id }));
  const startedBill = await startBillForBillingScreen({ tableSessionId: tableSession.id, itemsBySplit: { A: billLines }, actorUserId: cashier.id, pricing: { taxMode: 'taxable', taxRate: 5 }, locale: 'en' });
  assert(startedBill.calculationBreakdown.totalDue > 0, 'Billing browser screen should calculate a positive total.');
  const billing = await openBillingScreen(tableSession.id, 'my');
  assert(billing.receiptPreview.tableSessionId === tableSession.id, 'Billing browser screen should load receipt preview for the session.');
  await recordSplitPayment({ tableSessionId: tableSession.id, splitLabel: 'A', amount: startedBill.calculationBreakdown.totalDue, method: 'cash', actorUserId: cashier.id });
  order = await advanceOrderStatus(waiter, order.id, order.version, 'completed');
  order = await advanceOrderStatus(waiter, order.id, order.version, 'delivered');
  const closeResult = await closePaidTableFromBillingScreen({ user: cashier, tableSessionId: tableSession.id, branchId, locale: 'en' });
  assert(closeResult.closedSession.status === 'closed', 'Close paid table action should return a closed session.');
  assert(closeResult.floor.tables.some((row) => row.table.id === table.id && row.status === 'available'), 'Close paid table action should refresh the floor with the table available.');

  const menuDashboard = await loadAdminMenuDashboard('en');
  assert(menuDashboard.categories.some((row) => row.id === category.id), 'Admin menu browser screen should load menu categories.');

  const inventoryAlerts = await loadAdminInventoryAlerts('en');
  assert(inventoryAlerts.policy === 'on_in_preparation', 'Admin inventory browser screen should load deduction policy.');

  const auditViewer = await loadAdminAuditViewer(manager, { query: order.id, limit: 20, locale: 'en' });
  assert(auditViewer.rows.some((row) => row.summary.includes(order.id)), 'Admin audit browser screen should render audit rows for the order.');

  assert(permissionsFor('manager').includes(Actions.ViewAudit), 'Manager permissions fixture should match audit browser coverage.');
}

runBrowserScreenE2e()
  .then(() => console.log('Browser screen E2E flow completed successfully.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
