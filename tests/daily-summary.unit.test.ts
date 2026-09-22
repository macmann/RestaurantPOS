declare const process: { env: Record<string, string | undefined>; exitCode?: number };
import type { AuthenticatedUser } from '../backend/auth/policies';
import { saveBill, type BillRecord, type BillSplit, type BillPayment } from '../backend/billing/repository';
import { createOrder, type OrderRecord } from '../backend/orders/repository';
import { getDailySummaryReport } from '../backend/reports/service';

const at = '2026-09-22T12:00:00.000Z';
function assert(actual: unknown, expected: unknown, label: string) { if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`); }
function payment(id: string, amount: number, method: BillPayment['method'], type: BillPayment['type'] = 'payment'): BillPayment {
  return { id, branchId: 'daily-test', splitLabel: 'A', amount, method, type, status: type === 'refund' ? 'refunded' : type === 'void' ? 'voided' : 'captured', paidAt: at, receivedByUserId: 'cashier-1' };
}
function split(label: 'A' | 'B', subtotal: number, discount: number, tax: number, unpaid: number, payments: BillPayment[], state: BillSplit['state'] = unpaid ? 'partially_paid' : 'paid'): BillSplit {
  const discounts = { itemLevel: discount, combo: 0, happyHour: 0, billLevel: 0, total: discount };
  const calculationBreakdown = { subtotal, discounts, taxableSubtotal: subtotal - discount, taxMode: tax ? 'taxable' as const : 'tax_exempt' as const, taxRate: tax ? 10 : 0, taxTotal: tax, totalDue: subtotal - discount + tax, roundingStrategy: 'round-half-up-to-cent-at-each-monetary-step' as const, appliedPromotions: [], lines: [] };
  return { label, lineItems: [], subtotal, discountTotal: discount, taxTotal: tax, totalDue: subtotal - discount + tax, amountPaid: subtotal - discount + tax - unpaid, unpaidBalance: unpaid, state, payments: payments.map((row) => ({ ...row, splitLabel: label })), calculationBreakdown };
}
function bill(id: string, branchId: string, splits: Record<string, BillSplit>, state: BillRecord['state']): BillRecord {
  const values = Object.values(splits); const subtotal = values.reduce((n, x) => n + x.subtotal, 0); const taxTotal = values.reduce((n, x) => n + x.taxTotal, 0); const totalDiscount = values.reduce((n, x) => n + x.discountTotal, 0);
  return { id, branchId, tableSessionId: `${id}-session`, splits: splits as any, state, pricing: { taxMode: taxTotal ? 'taxable' : 'tax_exempt', taxRate: 10 }, calculationBreakdown: { subtotal, discounts: { itemLevel: totalDiscount, combo: 0, happyHour: 0, billLevel: 0, total: totalDiscount }, taxableSubtotal: subtotal - totalDiscount, taxMode: taxTotal ? 'taxable' : 'tax_exempt', taxRate: 10, taxTotal, totalDue: subtotal - totalDiscount + taxTotal, roundingStrategy: 'round-half-up-to-cent-at-each-monetary-step', appliedPromotions: [], lines: [] }, createdAt: at, updatedAt: at };
}
function order(id: string, branchId = 'daily-test'): OrderRecord { return { id, branchId, tableSessionId: `${id}-bill-session`, serviceMode: 'dine_in', status: 'delivered', items: [], subtotal: 0, version: 1, createdBy: 'waiter-1', createdAt: at, updatedAt: at, changeLog: [], ...( { guestCount: 3, shiftId: 'dinner' } as any) }; }
async function run() {
  process.env.POS_BRANCH_ID = 'daily-test'; process.env.POS_BRANCH_TIMEZONE = 'UTC'; process.env.POS_BUSINESS_DAY_CUTOFF = '00:00';
  await createOrder(order('split')); await createOrder(order('debt')); await createOrder(order('other', 'other-branch'));
  await saveBill(bill('split-bill', 'daily-test', { A: split('A', 60, 10, 5, 0, [payment('cash', 30, 'cash'), payment('card', 25, 'card')]), B: split('B', 40, 0, 0, 10, [payment('wallet', 30, 'wallet')]) }, 'partially_paid'));
  await saveBill(bill('debt-bill', 'daily-test', { A: split('A', 20, 0, 0, 5, [payment('debt-pay', 15, 'cash'), payment('refund', 2, 'cash', 'refund'), payment('void', 1, 'cash', 'void')], 'debt') }, 'debt'));
  await saveBill(bill('void-bill', 'daily-test', { A: split('A', 10, 0, 0, 10, []) }, 'void'));
  await saveBill(bill('isolated', 'other-branch', { A: split('A', 999, 0, 0, 0, [payment('other', 999, 'cash')]) }, 'paid'));
  const user: AuthenticatedUser = { id: 'manager', branchId: 'daily-test', role: 'manager', status: 'active' };
  const { summary } = await getDailySummaryReport(user, { businessDate: '2026-09-22', branchId: 'daily-test' });
  assert(summary.grossSales, 120, 'split bills and branch isolation'); assert(summary.discounts.itemLevel, 10, 'discount type'); assert(summary.tax, 5, 'tax-exempt split'); assert(summary.netSales, 110, 'net sales');
  assert(summary.paymentTotals.cash, 45, 'cash mixed tender'); assert(summary.paymentTotals.card, 25, 'card mixed tender'); assert(summary.paymentTotals.wallet, 30, 'wallet mixed tender'); assert(summary.refunds, 2, 'refund'); assert(summary.voids, 11, 'payment and invoice voids'); assert(summary.debts, 5, 'debt'); assert(summary.outstandingBalances, 15, 'partial and debt balances'); assert(summary.invoiceCount, 2, 'invoice count excludes void'); assert(summary.guestCount, 6, 'guest count');
}
run().then(() => console.log('Daily summary unit tests completed successfully.')).catch((error) => { console.error(error); process.exitCode = 1; });
