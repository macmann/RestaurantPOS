declare const process: { exitCode?: number };

import { AdminAuditApi } from '../backend/audit/controller';
import type { AuthenticatedUser } from '../backend/auth/policies';
import { recordSplitPayment } from '../backend/billing/service';
import { resetOrderPrinterAdapter } from '../backend/hardware/orderPrinter';
import { createInventoryMasterItem, listInventoryWithBalances, saveMenuInventoryRecipe } from '../backend/inventory/service';
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
  const menuItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Tea Leaf Rice', price: 7.5, prepStation: 'kitchen', inventoryItemId: rice.id, taxMode: 'taxable', taxRate: 5, isAvailable: true });
  await saveMenuInventoryRecipe({ branchId, menuItemId: menuItem.id, inventoryItemId: rice.id, quantityPerUnit: 1 });
  assert(menuItem.isAvailable, 'Menu item should be available for order entry.');


  const broth = await createInventoryMasterItem({ branchId, sku: 'BROTH-E2E', name: 'Broth liters', unit: 'liter', minimumThreshold: 1, currentStock: 10 });
  const mappedCombo = await adminCreateItem({ branchId, categoryId: category.id, name: 'Mapped Combo E2E', price: 9, prepStation: 'kitchen', isAvailable: true });
  await saveMenuInventoryRecipe({ branchId, menuItemId: mappedCombo.id, inventoryItemId: rice.id, quantityPerUnit: 0.5 });
  await saveMenuInventoryRecipe({ branchId, menuItemId: mappedCombo.id, inventoryItemId: broth.id, quantityPerUnit: 0.25 });
  const mappedOrder = await createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Mapped Guest', items: [{ menuItemId: mappedCombo.id, quantity: 2 }] });
  await transitionOrderStatus(waiter, mappedOrder.id, mappedOrder.version, 'in_preparation');
  let inventoryAfterMappedOrder = await listInventoryWithBalances();
  assertEqual(inventoryAfterMappedOrder.find((item) => item.id === rice.id)?.currentBalance, 19, 'Recipe mapping should deduct mapped rice quantity instead of menu item id');
  assertEqual(inventoryAfterMappedOrder.find((item) => item.id === broth.id)?.currentBalance, 9.5, 'Recipe mapping should deduct each mapped ingredient');

  const unmappedItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Unmapped E2E', price: 5, prepStation: 'kitchen', isAvailable: true });
  const unmappedOrder = await createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Unmapped Guest', items: [{ menuItemId: unmappedItem.id, quantity: 1 }] });
  await assertRejects(() => transitionOrderStatus(waiter, unmappedOrder.id, unmappedOrder.version, 'in_preparation'), 'Missing inventory recipe mapping');

  const scarce = await createInventoryMasterItem({ branchId, sku: 'SCARCE-E2E', name: 'Scarce ingredient', unit: 'portion', minimumThreshold: 1, currentStock: 1 });
  const scarceItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Scarce E2E', price: 5, prepStation: 'kitchen', isAvailable: true });
  await saveMenuInventoryRecipe({ branchId, menuItemId: scarceItem.id, inventoryItemId: scarce.id, quantityPerUnit: 2 });
  const scarceOrder = await createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Scarce Guest', items: [{ menuItemId: scarceItem.id, quantity: 1 }] });
  await assertRejects(() => transitionOrderStatus(waiter, scarceOrder.id, scarceOrder.version, 'in_preparation'), 'Insufficient stock');

  const idempotentOrder = await createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Retry Guest', items: [{ menuItemId: mappedCombo.id, quantity: 1 }] });
  const idempotentTransition = await transitionOrderStatus(waiter, idempotentOrder.id, idempotentOrder.version, 'in_preparation');
  await assertRejects(() => transitionOrderStatus(waiter, idempotentOrder.id, idempotentOrder.version, 'in_preparation'), 'Version conflict detected');
  inventoryAfterMappedOrder = await listInventoryWithBalances();
  assertEqual(inventoryAfterMappedOrder.find((item) => item.id === rice.id)?.currentBalance, 18.5, 'Retry after successful deduction should not double-deduct rice');
  assertEqual(inventoryAfterMappedOrder.find((item) => item.id === broth.id)?.currentBalance, 9.25, 'Retry after successful deduction should not double-deduct broth');
  assertEqual(idempotentTransition.status, 'in_preparation', 'Initial idempotency scenario transition should succeed');

  const stalePriceOrder = await createOrderDraft(waiter, {
    branchId,
    serviceMode: 'takeout',
    takeoutName: 'Stale Price Guest',
    items: [{ menuItemId: menuItem.id, quantity: 1, name: 'Client Forgery', unitPrice: 0.01, station: 'bar' } as any],
  });
  assertEqual(stalePriceOrder.items[0].name, menuItem.name, 'E2E order creation should derive item name from menu data');
  assertEqual(stalePriceOrder.items[0].unitPrice, menuItem.price, 'E2E order creation should reject stale client prices');
  assertEqual(stalePriceOrder.items[0].station, 'kitchen', 'E2E order creation should derive prep station from menu data');
  assertEqual(stalePriceOrder.items[0].taxRate, 5, 'E2E order creation should derive tax metadata from menu data');

  const unavailableItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Sold Out Salad E2E', price: 4, isAvailable: false });
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Unavailable Guest', items: [{ menuItemId: unavailableItem.id, quantity: 1 }] }),
    'is unavailable',
  );
  const overrideOrder = await createOrderDraft(manager, {
    branchId,
    serviceMode: 'takeout',
    takeoutName: 'Override Guest',
    items: [{ menuItemId: unavailableItem.id, quantity: 1, allowUnavailableOverride: true, overrideReason: 'Manager approved last portion' }],
  });
  assertEqual(overrideOrder.items[0].unitPrice, unavailableItem.price, 'E2E manager override should still use authoritative unavailable item price');

  const inactiveMenuItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Inactive Item E2E', price: 5.5, isActive: false, isAvailable: true });
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Inactive Item Guest', items: [{ menuItemId: inactiveMenuItem.id, quantity: 1 }] }),
    'is inactive',
  );

  const inactiveCategory = await adminCreateCategory({ branchId, name: 'Inactive E2E Specials', sortOrder: 99, isActive: false });
  const inactiveItem = await adminCreateItem({ branchId, categoryId: inactiveCategory.id, name: 'Inactive Soup E2E', price: 6, isAvailable: true });
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Inactive Guest', items: [{ menuItemId: inactiveItem.id, quantity: 1 }] }),
    'is inactive',
  );

  const otherBranchCategory = await adminCreateCategory({ branchId: 'branch-e2e-other', name: 'Other Branch E2E', sortOrder: 1 });
  const otherBranchItem = await adminCreateItem({ branchId: 'branch-e2e-other', categoryId: otherBranchCategory.id, name: 'Other Branch Curry E2E', price: 8, isAvailable: true });
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Branch Guest', items: [{ menuItemId: otherBranchItem.id, quantity: 1 }] }),
    'Branch mismatch',
  );

  const table = await createTable({ id: 'T-E2E-01', branchId, name: 'Table E2E 01', capacity: 4 });
  const tableSession = await openTableSession(cashier, { tableId: table.id, guestCount: 4, branchId });
  await assertRejects(() => openTableSession(cashier, { tableId: table.id, guestCount: 2, branchId }), 'active session already exists');

  let order = await createOrderDraft(waiter, {
    branchId,
    serviceMode: 'dine_in',
    tableSessionId: tableSession.id,
    items: [{ menuItemId: menuItem.id, quantity: 2, note: 'Less oil', modifiers: ['less oil'] }],
  });
  assertEqual(order.subtotal, 15, 'Order subtotal should reflect seeded cart items');
  assertEqual(order.tableName, table.name, 'Dine-in orders should carry the table name for prep and printer routing.');
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
  assertEqual(riceBalance, 15.5, 'Inventory should auto-deduct when the order enters preparation');

  const kitchenQueue = await getKdsSnapshot('kitchen');
  const kitchenTicket = kitchenQueue.groups.flatMap((group) => group.items).find((item) => item.orderId === order.id);
  assert(kitchenTicket, 'KDS should receive the order item for kitchen preparation.');
  assertEqual(kitchenTicket.tableName, table.name, 'KDS prep items should show the dine-in table name.');
  const orderPrinter = resetOrderPrinterAdapter();
  const printedTickets = await orderPrinter.printOrderForConfiguredStations(order);
  const kitchenSlip = printedTickets.find((ticket) => ticket.station === 'kitchen');
  assert(kitchenSlip, 'Kitchen print slip should be generated for kitchen order items.');
  assert(kitchenSlip.renderedText.includes(`Order: ${order.id}`), 'Kitchen print slip should include the order number.');
  assert(kitchenSlip.renderedText.includes(`Table: ${table.name}`), 'Kitchen print slip should include the table name.');
  await updateKdsItemProgress(kitchen, order.id, kitchenTicket.orderItemId, 'ready');
  const activeKitchenQueue = await getKdsSnapshot('kitchen', 'active');
  const kitchenHistory = await getKdsSnapshot('kitchen', 'history');
  assert(!activeKitchenQueue.groups.flatMap((group) => group.items).some((item) => item.orderId === order.id), 'Ready KDS items should leave the active kitchen queue.');
  assert(kitchenHistory.groups.flatMap((group) => group.items).some((item) => item.orderId === order.id), 'Ready KDS items should move into kitchen history.');
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
  assert(inventoryReport.summary.totalUsed >= 4.5, 'Inventory report should include sale deduction usage.');
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
