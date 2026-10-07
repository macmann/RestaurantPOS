import type { AuthenticatedUser } from '../backend/auth/policies';
import { getBillByTableSessionId, type TableOrderItem } from '../backend/billing/repository';
import { generateBillFromSessionItems, recordSplitPayment, setBillCharges, setBillTaxMode, updateBillSplitItems } from '../backend/billing/service';
import { withOperationalWrite } from '../backend/db/operationalWrite';
import { updatePosOperationalSettings } from '../backend/config/posSettings';
import { renderReceiptPayload } from '../backend/hardware/receiptPrinter';
import { createInventoryMasterItem, listInventoryWithBalances, saveMenuInventoryRecipe } from '../backend/inventory/service';
import { adminCreateCategory, adminCreateItem } from '../backend/menu/service';
import { getKdsItemState, listKdsProgressHistory } from '../backend/kds/repository';
import { syncOrderIntoKds, updateKdsItemProgress } from '../backend/kds/service';
import { createOrder, getOrderById, type OrderRecord } from '../backend/orders/repository';
import { cancelOrder, createOrderDraft, editOrderBeforePayment, transitionOrderStatus, voidOrderItem } from '../backend/orders/service';
import { getDailySummaryReport, getExceptionReport } from '../backend/reports/service';
import { createTable, getTableSession, listTableFloor, openTableSession, transferTableSession } from '../backend/tables/service';
import { assert, assertEqual, assertRejects } from './helpers/assertions';
import { apiRequest, login, seedLoginUser, startTestServer } from './helpers/apiTestHarness';

const branchId = 'transfer-void-charge-test';
const manager: AuthenticatedUser = { id: 'workflow-manager', branchId, role: 'manager', status: 'active' };
const cashier: AuthenticatedUser = { ...manager, id: 'workflow-cashier', role: 'cashier' };
const waiter: AuthenticatedUser = { ...manager, id: 'workflow-waiter', role: 'waitstaff' };
let sequence = 0;

async function fixture(name: string, prices = [100, 50]) {
  const table = await createTable({ branchId, name, capacity: 4 });
  const session = await openTableSession(waiter, { tableId: table.id, guestCount: 2 });
  const now = new Date().toISOString();
  const order: OrderRecord = { id: `workflow-order-${++sequence}`, branchId, serviceMode: 'dine_in', tableId: table.id, tableName: table.name, tableSessionId: session.id,
    status: 'completed', version: 1, createdBy: waiter.id, createdAt: now, updatedAt: now, changeLog: [], subtotal: prices.reduce((sum, price) => sum + price, 0),
    items: prices.map((price, index) => ({ id: `workflow-item-${sequence}-${index}`, menuItemId: `workflow-menu-${index}`, name: `Meal ${index}`, quantity: 1, unitPrice: price, lineTotal: price, station: 'kitchen' })) };
  await createOrder(order); await syncOrderIntoKds(order);
  return { table, session, order };
}
function lines(order: OrderRecord, sessionId = order.tableSessionId!): TableOrderItem[] {
  return order.items.map(item => ({ ...item, orderId: order.id, tableSessionId: sessionId }));
}

async function run() {
  process.env.POS_BRANCH_ID = branchId;
  updatePosOperationalSettings({ tax: { enabled: true, rate: 5 }, serviceCharge: { rate: 10 } });
  const source = await fixture('Table 1');
  const sourceLines = lines(source.order);
  const bill = await generateBillFromSessionItems(source.session.id, { A: [{ ...sourceLines[0], itemDiscount: 10 }], B: [sourceLines[1]] }, cashier.id);
  assertEqual(bill.calculationBreakdown.serviceChargeTotal, 14, 'Service charge uses discounted subtotal');
  assertEqual(bill.calculationBreakdown.taxTotal, 7, 'Tax calculated separately on discounted subtotal');
  assertEqual(bill.calculationBreakdown.totalDue, 161, 'Total includes both charges');
  assertEqual(bill.splits.A.totalDue + bill.splits.B.totalDue + bill.splits.C.totalDue, 161, 'Split totals reconcile');
  updatePosOperationalSettings({ serviceCharge: { rate: 20 } });
  const noCharges = await setBillCharges({ tableSessionId: source.session.id, includeTax: false, includeServiceCharge: false, actorUserId: cashier.id });
  assertEqual(noCharges.calculationBreakdown.totalDue, 140, 'Both charges can be removed');
  const restored = await setBillCharges({ tableSessionId: source.session.id, includeTax: true, includeServiceCharge: true, actorUserId: cashier.id });
  assertEqual(restored.calculationBreakdown.totalDue, 161, 'Existing bills retain original configured rate');
  await assertRejects(() => setBillCharges({ tableSessionId: source.session.id, includeTax: false, includeServiceCharge: false, actorUserId: cashier.id, branchId: 'other-branch' }), 'Forbidden');

  const empty = await createTable({ branchId, name: 'Table 2', capacity: 4 });
  const moved = await transferTableSession(waiter, source.session.id, { destinationTableId: empty.id });
  assertEqual((await getTableSession(source.session.id))!.status, 'closed', 'Source closes after transfer');
  assertEqual(moved.guestCount, 2, 'Guest count transfers');
  assertEqual((await getOrderById(source.order.id))!.tableSessionId, moved.id, 'Order IDs preserved at new session');
  const kds = await getKdsItemState(source.order.id, source.order.items[0].id);
  assertEqual(kds!.progress, 'ready', 'Preparation state preserved');
  assertEqual(kds!.tableName, 'Table 2', 'KDS destination updated');
  const movedBill = (await getBillByTableSessionId(moved.id))!;
  assertEqual(movedBill.calculationBreakdown.totalDue, 161, 'Transfer preserves charges and discounts');
  assertEqual(movedBill.splits.B.lineItems[0].orderItemId, source.order.items[1].id, 'Split assignment retained');
  assertEqual((await getBillByTableSessionId(source.session.id))!.calculationBreakdown.totalDue, 0, 'No duplicate charge remains at source');

  const occupied = await fixture('Table 3', [40]);
  await generateBillFromSessionItems(occupied.session.id, { A: lines(occupied.order) }, cashier.id);
  await assertRejects(() => transferTableSession(waiter, moved.id, { destinationTableId: occupied.table.id }), 'Confirm merge');
  assertEqual((await getTableSession(moved.id))!.status, 'open', 'Unconfirmed merge leaves source unchanged');
  const merged = await transferTableSession(waiter, moved.id, { destinationTableId: occupied.table.id, merge: true });
  assertEqual(merged.id, occupied.session.id, 'Occupied destination session is reused');
  assertEqual(merged.guestCount, 4, 'Guests combine');
  assertEqual((await getBillByTableSessionId(merged.id))!.calculationBreakdown.totalDue, 225, 'Destination 20% service rate applies to discounted combined bill');

  const movedOrder = (await getOrderById(source.order.id))!;
  const removedItem = movedOrder.items[0];
  await assertRejects(() => voidOrderItem(cashier, movedOrder.id, removedItem.id, { expectedVersion: movedOrder.version, reason: 'Wrong dish' }), 'Forbidden');
  await assertRejects(() => editOrderBeforePayment(waiter, movedOrder.id, { expectedVersion: movedOrder.version, removeItemIds: [removedItem.id] }), 'Prepared items');
  await assertRejects(() => editOrderBeforePayment(waiter, movedOrder.id, { expectedVersion: movedOrder.version, modifyItems: [{ id: removedItem.id, quantity: 0.5 }] }), 'Prepared items');
  await assertRejects(() => cancelOrder(waiter, movedOrder.id, { expectedVersion: movedOrder.version, reason: 'Wrong dish' }), 'Forbidden');
  await assertRejects(() => voidOrderItem(manager, movedOrder.id, removedItem.id, { expectedVersion: movedOrder.version, reason: ' ' }), 'reason');
  await assertRejects(() => voidOrderItem(manager, movedOrder.id, removedItem.id, { expectedVersion: 0, reason: 'Wrong dish' }), 'Version conflict');
  await assertRejects(() => withOperationalWrite(async () => {
    await voidOrderItem(manager, movedOrder.id, removedItem.id, { expectedVersion: movedOrder.version, reason: 'Rollback test' });
    throw new Error('Injected memory failure');
  }), 'Injected memory failure');
  assertEqual((await getOrderById(movedOrder.id))!.items.length, 2, 'Memory rollback restores removed item');
  assertEqual((await getBillByTableSessionId(merged.id))!.calculationBreakdown.totalDue, 225, 'Memory rollback restores bill totals');
  assertEqual((await getKdsItemState(movedOrder.id, removedItem.id))!.progress, 'ready', 'Memory rollback restores preparation state');
  await assertRejects(() => updateBillSplitItems({ tableSessionId: merged.id, actorUserId: cashier.id, itemsBySplit: { A: lines(occupied.order), B: [lines(movedOrder)[1]] } }), 'Split quantities');
  const voided = await voidOrderItem(manager, movedOrder.id, removedItem.id, { expectedVersion: movedOrder.version, reason: 'Wrong dish prepared' });
  assertEqual(voided.items.length, 1, 'Prepared item removed');
  assertEqual((await getBillByTableSessionId(merged.id))!.calculationBreakdown.totalDue, 112.5, 'Bill repriced without voided item including charges');
  assertEqual(await getKdsItemState(voided.id, removedItem.id), null, 'Voided item leaves KDS');
  assert((await listKdsProgressHistory()).some(row => row.orderItemId === removedItem.id && row.progress === 'cancelled'), 'Cancellation history retained');
  const report = await getExceptionReport(manager, { branchId, dateFrom: new Date(Date.now() - 60_000).toISOString(), dateTo: new Date(Date.now() + 60_000).toISOString() });
  const voidRow = report.rows.find(row => row.orderId === voided.id && row.category === 'item_removals');
  assertEqual(voidRow?.reason, 'Wrong dish prepared', 'Void reason reviewable');
  assertEqual(voidRow?.approvingManagerId, manager.id, 'Void approver reviewable');
  assertEqual(voidRow?.amount, 100, 'Original removed value retained');

  await assertRejects(() => updateBillSplitItems({ tableSessionId: merged.id, actorUserId: cashier.id, itemsBySplit: { A: [...lines(occupied.order), ...lines(movedOrder)] } }), 'removed or invalid');

  await recordSplitPayment({ tableSessionId: merged.id, splitLabel: 'A', amount: 1, method: 'cash', actorUserId: cashier.id });
  await assertRejects(() => voidOrderItem(manager, voided.id, voided.items[0].id, { expectedVersion: voided.version, reason: 'After payment' }), 'after payment');
  await assertRejects(() => transferTableSession(waiter, merged.id, { destinationTableId: empty.id }), 'after payment');
  await assertRejects(() => setBillCharges({ tableSessionId: merged.id, includeTax: false, includeServiceCharge: false, actorUserId: cashier.id }), 'after payment');
  await assertRejects(() => setBillTaxMode({ tableSessionId: merged.id, taxMode: 'tax_exempt', actorUserId: cashier.id }), 'after payment');

  const rounding = await fixture('Table 4', [0.05, 0.05, 0.05]);
  updatePosOperationalSettings({ serviceCharge: { rate: 10 } });
  const roundedBill = await generateBillFromSessionItems(rounding.session.id, { A: [lines(rounding.order)[0]], B: [lines(rounding.order)[1]], C: [lines(rounding.order)[2]] }, cashier.id);
  assertEqual(roundedBill.calculationBreakdown.serviceChargeTotal, 0.02, 'Service charge rounds at bill level');
  assertEqual(Object.values(roundedBill.splits).reduce((sum, split) => sum + (split.calculationBreakdown.serviceChargeTotal ?? 0), 0), 0.02, 'Split allocation reconciles exact service charge');
  assert(Object.values(roundedBill.splits).every(split => (split.calculationBreakdown.serviceChargeTotal ?? 0) >= 0), 'Split service charges cannot become negative');
  const unsplit = await fixture('Table ' + '9'.repeat(70), [100]);
  const printBill = await generateBillFromSessionItems(unsplit.session.id, { A: lines(unsplit.order) }, cashier.id);
  const rendered = renderReceiptPayload(printBill.receiptPayload!);
  const tableLines = rendered.split('\n').filter(line => line.startsWith('Table:'));
  assertEqual(tableLines.length, 1, 'One compact table header');
  assert(tableLines[0].length <= 48, 'Table heading stays within printer width');
  assert(rendered.includes('Service charge (10%)'), 'Printed receipt contains service charge');
  assert(!rendered.includes('*** TABLE:'), 'No oversized receipt table banner');
  const daily = await getDailySummaryReport(manager, { branchId });
  assert(daily.summary.serviceCharges > 0, 'Service charges appear in daily summary');

  const parallel = await fixture('Concurrent source', [12]);
  const dest1 = await createTable({ branchId, name: 'Concurrent 1', capacity: 4 });
  const dest2 = await createTable({ branchId, name: 'Concurrent 2', capacity: 4 });
  const attempts = await Promise.allSettled([transferTableSession(waiter, parallel.session.id, { destinationTableId: dest1.id }), transferTableSession(waiter, parallel.session.id, { destinationTableId: dest2.id })]);
  assertEqual(attempts.filter(result => result.status === 'fulfilled').length, 1, 'Exactly one concurrent transfer succeeds');
  assertEqual((await listTableFloor(branchId)).filter(row => [dest1.id, dest2.id].includes(row.table.id) && row.activeSession).length, 1, 'No orphan destination session');
  const crossBranch = await createTable({ branchId: 'other', name: 'Other branch', capacity: 4 });
  await assertRejects(() => transferTableSession(waiter, rounding.session.id, { destinationTableId: crossBranch.id }), 'Forbidden');

  const delivered = await fixture('Delivered void');
  await createOrder({ ...delivered.order, status: 'delivered' });
  await voidOrderItem({ ...manager, role: 'superadmin' }, delivered.order.id, delivered.order.items[0].id, { expectedVersion: 1, reason: 'Superadmin void after delivery' });
  assertEqual((await getOrderById(delivered.order.id))!.items.length, 1, 'Superadmin can remove delivered items before payment');

  updatePosOperationalSettings({ menuInventoryLinkEnabled: true });
  const stock = await createInventoryMasterItem({ branchId, sku: 'VOID-INGREDIENT', name: 'Prepared food ingredient', unit: 'portion', minimumThreshold: 1, currentStock: 5 });
  const category = await adminCreateCategory({ branchId, name: 'Void inventory tests', sortOrder: 1 });
  const meal = await adminCreateItem({ branchId, categoryId: category.id, name: 'Prepared meal', price: 10, prepStation: 'kitchen', isAvailable: true });
  await saveMenuInventoryRecipe({ branchId, menuItemId: meal.id, inventoryItemId: stock.id, quantityPerUnit: 1 });
  const stockTable = await createTable({ branchId, name: 'Stock void', capacity: 4 });
  const stockSession = await openTableSession(waiter, { tableId: stockTable.id, guestCount: 1 });
  let cooked = await createOrderDraft(waiter, { serviceMode: 'dine_in', tableSessionId: stockSession.id, items: [{ menuItemId: meal.id, quantity: 1 }] });
  cooked = await transitionOrderStatus(waiter, cooked.id, cooked.version, 'in_preparation');
  cooked = await transitionOrderStatus(waiter, cooked.id, cooked.version, 'completed');
  assertEqual((await listInventoryWithBalances()).find(row => row.id === stock.id)!.currentBalance, 4, 'Cooking deducts ingredient');
  await voidOrderItem(manager, cooked.id, cooked.items[0].id, { expectedVersion: cooked.version, reason: 'Cooked food discarded' });
  assertEqual((await listInventoryWithBalances()).find(row => row.id === stock.id)!.currentBalance, 4, 'Prepared void does not return cooked ingredients');

  const password = 'workflow-test-password';
  await seedLoginUser({ ...cashier, username: cashier.id, password });
  await seedLoginUser({ ...manager, username: manager.id, password });
  const server = await startTestServer();
  try {
    const cashierLogin = await login(server.baseUrl, cashier.id, password);
    const denied = await apiRequest(server.baseUrl, `/api/orders/${rounding.order.id}/items/${rounding.order.items[0].id}/void`, { method: 'POST', token: cashierLogin.token, body: { expectedVersion: 1, reason: 'Unauthorized' } });
    assertEqual(denied.status, 403, 'HTTP void endpoint enforces RBAC');
    const changed = await apiRequest(server.baseUrl, `/api/billing/bills/${rounding.session.id}/charges`, { method: 'PATCH', token: cashierLogin.token, body: { includeTax: false, includeServiceCharge: false } });
    assertEqual(changed.status, 200, 'Cashier can toggle charges through API');
    const managerLogin = await login(server.baseUrl, manager.id, password);
    const removed = await apiRequest(server.baseUrl, `/api/orders/${rounding.order.id}/items/${rounding.order.items[0].id}/void`, { method: 'POST', token: managerLogin.token, body: { expectedVersion: 1, reason: 'Manager HTTP void' } });
    assertEqual(removed.status, 200, 'Manager can void prepared items through API');
  } finally { await server.close(); }
}
run().then(() => console.log('Table transfers, prepared voids and bill charges integration tests passed.')).catch(error => { console.error(error); process.exitCode = 1; });
