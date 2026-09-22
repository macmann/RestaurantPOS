declare const process: { env: Record<string, string | undefined>; exitCode?: number };

import type { AuthenticatedUser } from '../backend/auth/policies';
import { saveBill, type BillCalculationBreakdown, type BillPayment, type BillRecord, type BillingState } from '../backend/billing/repository';
import { createOrder, type OrderRecord, type OrderStatus } from '../backend/orders/repository';
import { getSalesReport } from '../backend/reports/service';
import { getBusinessDayRange } from '../shared/business-day';

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
}

function order(id: string, status: OrderStatus, createdAt: string, amount: number): OrderRecord {
  return {
    id, branchId: 'reports-test', serviceMode: 'takeout', takeoutName: 'Test', status,
    items: [{ id: `${id}-item`, menuItemId: 'menu-test', name: 'Test item', quantity: 1, unitPrice: amount, lineTotal: amount }],
    subtotal: amount, version: 1, createdBy: 'waiter', createdAt, updatedAt: createdAt, changeLog: [],
  };
}

function bill(id: string, state: BillingState, updatedAt: string, payments: BillPayment[], unpaidBalance: number): BillRecord {
  const breakdown: BillCalculationBreakdown = { subtotal: 100, discounts: { itemLevel: 10, combo: 0, happyHour: 0, billLevel: 0, total: 10 }, taxableSubtotal: 90, taxMode: 'taxable', taxRate: 10, taxTotal: 9, totalDue: 99, roundingStrategy: 'round-half-up-to-cent-at-each-monetary-step', appliedPromotions: [], lines: [] };
  const split = { label: 'A', lineItems: [], subtotal: 100, discountTotal: 10, taxTotal: 9, totalDue: 99, amountPaid: 99 - unpaidBalance, unpaidBalance, state, payments, calculationBreakdown: breakdown };
  return { id, branchId: 'reports-test', tableSessionId: `${id}-session`, splits: { A: split } as any, state, pricing: { taxMode: 'taxable', taxRate: 10 }, calculationBreakdown: breakdown, createdAt: updatedAt, updatedAt };
}

function payment(id: string, amount: number, paidAt: string, type: 'payment' | 'refund' | 'void' = 'payment', status: BillPayment['status'] = 'captured'): BillPayment {
  return { id, branchId: 'reports-test', splitLabel: 'A', amount, method: 'cash', paidAt, receivedByUserId: 'cashier', type, status };
}

async function run(): Promise<void> {
  process.env.POS_BRANCH_ID = 'reports-test';
  process.env.POS_BRANCH_TIMEZONE = 'America/New_York';
  process.env.POS_BUSINESS_DAY_CUTOFF = '04:00';
  const range = getBusinessDayRange(new Date('2026-01-02T06:00:00.000Z'), { timezone: 'America/New_York', businessDayCutoff: '04:00' });
  assertEqual(range.dateFrom, '2026-01-01T09:00:00.000Z', 'Business day should begin at the configured local cutoff');
  assertEqual(range.dateTo, '2026-01-02T08:59:59.999Z', 'Business day should end immediately before the next local cutoff');

  await createOrder(order('report-active-midnight', 'delivered', '2026-01-02T05:30:00.000Z', 50));
  await createOrder(order('report-cancelled', 'cancelled', '2026-01-02T06:00:00.000Z', 70));
  await createOrder(order('report-next-day', 'delivered', '2026-01-02T09:00:00.000Z', 90));
  const at = '2026-01-02T06:30:00.000Z';
  await saveBill(bill('report-open', 'open', at, [], 99));
  await saveBill(bill('report-partial', 'partially_paid', at, [payment('partial-payment', 40, at)], 59));
  await saveBill(bill('report-debt', 'debt', at, [payment('debt-payment', 20, at), payment('debt-refund', 5, at, 'refund', 'refunded')], 84));
  await saveBill(bill('report-payment-void', 'open', at, [payment('void-original', 30, at, 'payment', 'voided'), payment('void-entry', 30, at, 'void', 'voided')], 99));

  const manager: AuthenticatedUser = { id: 'report-manager', branchId: 'reports-test', role: 'manager', status: 'active' };
  const report = await getSalesReport(manager, 'day', { branchId: 'reports-test', ...range });
  assertEqual(report.summary.orderCount, 1, 'Cancelled and next-business-day orders must not count as sold orders');
  assertEqual(report.summary.quantitySold, 1, 'Cancelled items must not count as sold items');
  assertEqual(report.summary.grossOrderedSales, 50, 'Gross ordered sales must exclude cancelled and out-of-range orders');
  assertEqual(report.summary.cancelledOrderCount, 1, 'Cancelled activity should be exposed separately');
  assertEqual(report.summary.cancelledOrderValue, 70, 'Cancelled order value should be exposed separately');
  assertEqual(report.summary.discounts, 40, 'Discounts should be explicit across non-void bills');
  assertEqual(report.summary.tax, 36, 'Tax should be explicit across non-void bills');
  assertEqual(report.summary.netSales, 360, 'Net sales should exclude discounts and tax');
  assertEqual(report.summary.recognizedRevenue, 396, 'Recognized revenue should include net sales and tax');
  assertEqual(report.summary.collectedPayments, 55, 'Collections should use payment ledger contributions');
  assertEqual(report.summary.refunds, 5, 'Refund ledger entries should reduce and be reported separately');
  assertEqual(report.summary.voids, 30, 'Payment void entries should reverse original collections');
  assertEqual(report.summary.outstandingBalance, 341, 'Open, partial, and debt balances should remain outstanding');
}

run().then(() => console.log('Report business-day tests completed successfully.')).catch((error) => { console.error(error); process.exitCode = 1; });
