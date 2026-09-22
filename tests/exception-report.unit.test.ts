declare const process: { env: Record<string, string | undefined>; exitCode?: number };
import type { AuthenticatedUser } from '../backend/auth/policies';
import { saveBill, type BillRecord, type BillSplit } from '../backend/billing/repository';
import { createOrder, type OrderRecord } from '../backend/orders/repository';
import { getDailySummaryReport, getExceptionReport } from '../backend/reports/service';
import { assert, assertEqual, assertRejects } from './helpers/assertions';

const at = '2026-09-22T12:00:00.000Z';
const breakdown = { subtotal: 25, discounts: { itemLevel: 0, combo: 0, happyHour: 0, billLevel: 0, total: 0 }, taxableSubtotal: 25, taxMode: 'tax_exempt' as const, taxRate: 0, taxTotal: 0, totalDue: 25, roundingStrategy: 'round-half-up-to-cent-at-each-monetary-step' as const, appliedPromotions: [], lines: [] };
const split: BillSplit = { label: 'A', lineItems: [], subtotal: 25, taxTotal: 0, discountTotal: 0, totalDue: 25, amountPaid: 0, unpaidBalance: 25, state: 'open', calculationBreakdown: breakdown, payments: [
  { id: 'original-pay', branchId: 'exception-test', splitLabel: 'A', amount: 25, method: 'card', paidAt: at, receivedByUserId: 'cashier', type: 'payment', status: 'voided' },
  { id: 'void-pay', branchId: 'exception-test', splitLabel: 'A', amount: 25, method: 'card', paidAt: at, receivedByUserId: 'cashier', approvedByUserId: 'manager', type: 'void', status: 'voided', linkedPaymentId: 'original-pay', reason: 'Duplicate charge' },
] };

async function run() {
  process.env.POS_BRANCH_ID = 'exception-test'; process.env.POS_BRANCH_TIMEZONE = 'UTC';
  const order: OrderRecord = { id: 'exception-order', branchId: 'exception-test', serviceMode: 'dine_in', tableSessionId: 'exception-session', tableName: 'T1', status: 'cancelled',
    items: [{ id: 'item-1', menuItemId: 'menu-1', name: 'Soup', quantity: 1, unitPrice: 25, lineTotal: 25 }], subtotal: 25, version: 2, createdBy: 'waiter', createdAt: at, updatedAt: at,
    changeLog: [{ at, actorUserId: 'waiter', actorRole: 'waitstaff', approverUserId: 'manager', action: 'item_removed', details: { itemId: 'item-1', itemName: 'Soup', quantity: 1, amount: 25 }, originalValue: { id: 'item-1', name: 'Soup', quantity: 1, lineTotal: 25 }, finalValue: null, reason: 'Guest changed mind' },
      { at, actorUserId: 'waiter', actorRole: 'waitstaff', approverUserId: 'manager', action: 'order_cancelled', details: { reason: 'Kitchen closed' }, originalValue: { status: 'pending', subtotal: 25 }, finalValue: { status: 'cancelled', subtotal: 0 }, reason: 'Kitchen closed' }] };
  const bill: BillRecord = { id: 'exception-invoice', branchId: 'exception-test', tableSessionId: 'exception-session', tableName: 'T1', splits: { A: split } as any, state: 'void', pricing: { taxMode: 'tax_exempt', taxRate: 0 }, calculationBreakdown: breakdown, createdAt: at, updatedAt: at };
  await createOrder(order); await saveBill(bill);
  const manager: AuthenticatedUser = { id: 'manager', branchId: 'exception-test', role: 'manager', status: 'active' };
  const report = await getExceptionReport(manager, { businessDate: '2026-09-22', branchId: 'exception-test' });
  assertEqual(report.summary.categoryTotals.payment_voids.amount, 25, 'Payment void total');
  assertEqual(report.summary.categoryTotals.order_cancellations.amount, 25, 'Cancellation total');
  assertEqual(report.summary.categoryTotals.item_removals.amount, 25, 'Removal total');
  assert(report.rows.every((row) => row.businessDate === '2026-09-22' && row.originalTransactionReference), 'Drill-down rows should retain business date and original references.');
  const daily = await getDailySummaryReport(manager, { businessDate: '2026-09-22', branchId: 'exception-test' });
  assertEqual(report.summary.categoryTotals.payment_voids.amount, daily.summary.voids - 25, 'Payment exception should reconcile separately from the void invoice.');
  await assertRejects(() => getExceptionReport({ id: 'waiter', branchId: 'exception-test', role: 'waitstaff', status: 'active' }), 'Forbidden');
}
run().then(() => console.log('Exception report unit tests completed successfully.')).catch((error) => { console.error(error); process.exitCode = 1; });
