import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import { getCurrentBranchId } from '../config/branch';
import { getRuntimeSettings } from '../config/branch';
import { t, normalizeLocale, getTypographyForLocale } from '../i18n/service';
import { listBills, type BillLineItem, type BillRecord, type BillSplit } from '../billing/repository';
import { listInventoryItems, listStockMovements, type InventoryItemRecord, type StockMovementRecord } from '../inventory/repository';
import { listOrders, type OrderItem, type OrderRecord } from '../orders/repository';
import { listAuditEvents, type AuditEventRecord } from '../audit/repository';
import { getBusinessDate, getBusinessDayRange } from '../../shared/business-day';

export type SalesPeriod = 'day' | 'week' | 'month';
export type ReportExportFormat = 'csv' | 'print';

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  cashierUserId?: string;
  waiterUserId?: string;
  businessDate?: string;
  shiftId?: string;
  serviceMode?: 'dine_in' | 'takeout';
  paymentMethod?: string;
  locale?: string;
  eventType?: ExceptionCategory;
  reason?: string;
}

export type ExceptionCategory = 'payment_voids' | 'refunds' | 'order_cancellations' | 'item_removals' | 'comps_price_overrides';

export interface ExceptionReportRow {
  id: string;
  category: ExceptionCategory;
  businessDate: string;
  occurredAt: string;
  branchId: string;
  orderId?: string;
  invoiceId?: string;
  table?: string;
  itemOrPaymentMethod?: string;
  quantity?: number;
  amount: number;
  reason?: string;
  initiatingUserId?: string;
  approvingManagerId?: string;
  originalTransactionReference?: string;
  originalValue?: unknown;
  finalValue?: unknown;
}

export interface ExceptionReportSummary {
  count: number;
  amount: number;
  categoryTotals: Record<ExceptionCategory, { count: number; amount: number }>;
  reconciliation: { paymentExceptions: number; cancelledSales: number; itemExceptions: number };
}

export interface DailySummary {
  businessDate: string;
  branchId?: string;
  grossSales: number;
  discounts: { itemLevel: number; combo: number; happyHour: number; billLevel: number; total: number };
  tax: number;
  serviceCharges: number;
  netSales: number;
  paymentTotals: Record<string, number>;
  refunds: number;
  voids: number;
  debts: number;
  outstandingBalances: number;
  orderCount: number;
  invoiceCount: number;
  guestCount?: number;
  averageCheck: number;
  firstTransactionAt?: string;
  lastTransactionAt?: string;
  tenderedTotal: number;
  tenderVariance: number;
}

export interface ExportColumn {
  key: string;
  label: string;
  type: 'string' | 'number' | 'currency' | 'date';
}

export interface ExportReadyReport<TSummary, TRow> {
  reportId: string;
  generatedAt: string;
  filters: Required<Pick<ReportFilters, 'dateFrom' | 'dateTo'>> & Omit<ReportFilters, 'dateFrom' | 'dateTo'>;
  export: {
    formats: ReportExportFormat[];
    columns: ExportColumn[];
    rows: TRow[];
    print: {
      title: string;
      subtitle: string;
      orientation: 'portrait' | 'landscape';
      locale: string;
      fontFamily: string;
      unicodeSample: string;
    };
  };
  summary: TSummary;
  rows: TRow[];
}

export interface SalesInvoiceRow {
  invoiceId: string;
  tableSessionId: string;
  issuedAt: string;
  amount: number;
  amountPaid: number;
  balanceDue: number;
  state: BillRecord['state'];
  paymentMethods: string[];
}

export interface SalesReportRow {
  periodStart: string;
  periodLabel: string;
  orderCount: number;
  quantitySold: number;
  revenue: number;
  metrics: ReportSalesMetrics;
  invoiceCount: number;
  invoiceTotal: number;
  invoices: SalesInvoiceRow[];
  items: Array<{
    menuItemId: string;
    itemName: string;
    quantitySold: number;
    grossSales: number;
    orderIds: string[];
  }>;
}

export interface ReportSalesMetrics {
  grossOrderedSales: number;
  discounts: number;
  tax: number;
  netSales: number;
  collectedPayments: number;
  refunds: number;
  voids: number;
  outstandingBalance: number;
  recognizedRevenue: number;
  cancelledOrderCount: number;
  cancelledOrderValue: number;
}

export interface InventoryUsageReportRow {
  itemId: string;
  sku: string;
  itemName: string;
  unit: string;
  openingStock: number;
  restocked: number;
  used: number;
  wastage: number;
  manualAdjustments: number;
  closingStock: number;
  trend: Array<{ at: string; movementType: string; quantityDelta: number; balanceAfter: number; referenceId?: string }>;
}

export interface FinancialSummaryRow {
  metric: keyof ReportSalesMetrics | 'revenue' | 'cogs' | 'gross_profit' | 'gross_margin_percent';
  amount: number;
}

interface NormalizedFilters extends Required<Pick<ReportFilters, 'dateFrom' | 'dateTo'>>, Omit<ReportFilters, 'dateFrom' | 'dateTo'> {}

const DEFAULT_REPORT_START = '1970-01-01T00:00:00.000Z';
const DEFAULT_REPORT_END = '9999-12-31T23:59:59.999Z';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeFilters(filters: ReportFilters = {}): NormalizedFilters {
  const branch = getRuntimeSettings().branch;
  let businessRange: ReturnType<typeof getBusinessDayRange> | undefined;
  if (filters.businessDate) {
    let anchor = new Date(`${filters.businessDate}T12:00:00.000Z`);
    businessRange = getBusinessDayRange(anchor, branch);
    // Noon UTC can cross a calendar boundary in extreme timezones; converge on the requested local date.
    for (let attempt = 0; attempt < 2 && businessRange.businessDate !== filters.businessDate; attempt += 1) {
      anchor = new Date(anchor.getTime() + (businessRange.businessDate < filters.businessDate ? 1 : -1) * 86400000);
      businessRange = getBusinessDayRange(anchor, branch);
    }
  }
  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom).toISOString() : businessRange?.dateFrom ?? DEFAULT_REPORT_START;
  const dateTo = filters.dateTo ? new Date(filters.dateTo).toISOString() : businessRange?.dateTo ?? DEFAULT_REPORT_END;
  if (dateFrom > dateTo) throw new Error('dateFrom must be before or equal to dateTo.');

  return {
    ...filters,
    locale: normalizeLocale(filters.locale),
    branchId: filters.branchId ?? getCurrentBranchId(),
    dateFrom,
    dateTo,
  };
}

function matchesOptionalField(row: unknown, field: string, expected?: string): boolean {
  return !expected || optionalRecordField(row, field) === expected;
}

function billOrders(bill: BillRecord, orders: OrderRecord[]): OrderRecord[] {
  return orders.filter((order) => order.tableSessionId === bill.tableSessionId || order.tableId === bill.tableSessionId);
}

function assertCanViewReports(user: AuthenticatedUser): void {
  if (!can(user, Actions.ViewReports)) throw new Error('Forbidden: cannot view reports.');
}

function assertCanViewSalesHistory(user: AuthenticatedUser): void {
  if (!can(user, Actions.ViewReports) && !can(user, Actions.ViewSalesHistory)) throw new Error('Forbidden: cannot view sales history.');
}

function optionalRecordField(row: unknown, key: string): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function isWithinRange(at: string, filters: NormalizedFilters): boolean {
  return at >= filters.dateFrom && at <= filters.dateTo;
}

function matchesBranch(row: unknown, filters: NormalizedFilters): boolean {
  if (!filters.branchId) return true;
  const branchId = optionalRecordField(row, 'branchId');
  return branchId === filters.branchId;
}

function exceptionBusinessDate(at: string): string {
  return getBusinessDate(at, getRuntimeSettings().branch);
}

function valueFrom(record: unknown, key: string): unknown {
  return record && typeof record === 'object' ? (record as Record<string, unknown>)[key] : undefined;
}

function numericValue(record: unknown, key: string): number | undefined {
  const value = Number(valueFrom(record, key));
  return Number.isFinite(value) ? value : undefined;
}

function flattenBillSplits(bill: BillRecord): BillSplit[] {
  return Object.values(bill.splits);
}

function billCashierIds(bill: BillRecord): Set<string> {
  return new Set(flattenBillSplits(bill).flatMap((split) => split.payments.map((payment) => payment.receivedByUserId)));
}

function billMatchesCashier(bill: BillRecord, filters: NormalizedFilters): boolean {
  return !filters.cashierUserId || billCashierIds(bill).has(filters.cashierUserId);
}

function billMatchesFilters(bill: BillRecord, filters: NormalizedFilters, orders: OrderRecord[] = []): boolean {
  if (!isWithinRange(bill.updatedAt, filters) || !billMatchesCashier(bill, filters)) return false;
  if (filters.branchId && !matchesBranch(bill, filters)) {
    const hasBranchOrder = orders.some((order) => order.tableId === bill.tableSessionId && matchesBranch(order, filters));
    if (!hasBranchOrder) return false;
  }
  if (filters.waiterUserId) {
    return orders.some((order) => order.tableId === bill.tableSessionId && order.createdBy === filters.waiterUserId);
  }
  return true;
}

function orderMatchesFilters(order: OrderRecord, filters: NormalizedFilters, bills: BillRecord[]): boolean {
  if (!isWithinRange(order.createdAt, filters)) return false;
  if (filters.waiterUserId && order.createdBy !== filters.waiterUserId) return false;
  if (!matchesBranch(order, filters)) return false;
  if (!filters.cashierUserId) return true;

  return bills.some((bill) => bill.tableSessionId === order.tableId && billMatchesCashier(bill, filters));
}

function periodKey(dateIso: string, period: SalesPeriod): string {
  const branch = getRuntimeSettings().branch;
  const businessDate = getBusinessDate(dateIso, { timezone: branch.timezone, businessDayCutoff: branch.businessDayCutoff });
  const date = new Date(`${businessDate}T00:00:00.000Z`);
  if (period === 'day') return businessDate;
  if (period === 'month') return businessDate.slice(0, 7);

  const weekDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = weekDate.getUTCDay() || 7;
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((weekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${weekDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function emptySalesMetrics(): ReportSalesMetrics {
  return { grossOrderedSales: 0, discounts: 0, tax: 0, netSales: 0, collectedPayments: 0, refunds: 0, voids: 0, outstandingBalance: 0, recognizedRevenue: 0, cancelledOrderCount: 0, cancelledOrderValue: 0 };
}

function ledgerAmounts(bill: BillRecord, filters: NormalizedFilters) {
  let payments = 0;
  let refunds = 0;
  let voids = 0;
  for (const payment of flattenBillSplits(bill).flatMap((split) => split.payments).filter((entry) => isWithinRange(entry.paidAt, filters))) {
    const type = payment.type ?? 'payment';
    if (type === 'refund' && payment.status !== 'failed') refunds += payment.amount;
    else if (type === 'void' && payment.status !== 'failed') voids += payment.amount;
    else if (type === 'payment' && payment.status !== 'failed' && payment.status !== 'authorized') payments += payment.amount;
  }
  return { collectedPayments: roundMoney(payments - refunds - voids), refunds: roundMoney(refunds), voids: roundMoney(voids) };
}

function lineRevenue(item: Pick<OrderItem, 'lineTotal'> | Pick<BillLineItem, 'lineTotal'>): number {
  return roundMoney(item.lineTotal);
}

function billTotalDue(bill: BillRecord): number {
  return roundMoney(flattenBillSplits(bill).reduce((sum, split) => sum + split.totalDue, 0));
}

function billAmountPaid(bill: BillRecord): number {
  return roundMoney(flattenBillSplits(bill).reduce((sum, split) => sum + split.amountPaid, 0));
}

function billPaymentMethods(bill: BillRecord): string[] {
  return [...new Set(flattenBillSplits(bill).flatMap((split) => split.payments.map((payment) => payment.method)))];
}

function salesInvoiceRow(bill: BillRecord): SalesInvoiceRow {
  const amount = billTotalDue(bill);
  const amountPaid = billAmountPaid(bill);
  return {
    invoiceId: bill.id,
    tableSessionId: bill.tableSessionId,
    issuedAt: bill.updatedAt,
    amount,
    amountPaid,
    balanceDue: roundMoney(amount - amountPaid),
    state: bill.state,
    paymentMethods: billPaymentMethods(bill),
  };
}

function makeReport<TSummary, TRow>(reportId: string, titleKey: string, filters: NormalizedFilters, columns: ExportColumn[], rows: TRow[], summary: TSummary): ExportReadyReport<TSummary, TRow> {
  const locale = normalizeLocale(filters.locale);
  const typography = getTypographyForLocale(locale);
  return {
    reportId,
    generatedAt: new Date().toISOString(),
    filters,
    export: {
      formats: ['csv', 'print'],
      columns,
      rows,
      print: {
        title: t(locale, 'reportHeadings', titleKey),
        subtitle: `${t(locale, 'reportHeadings', 'range')}: ${filters.dateFrom} to ${filters.dateTo}`,
        orientation: 'landscape',
        locale,
        fontFamily: typography.printFontFamily,
        unicodeSample: typography.unicodeSample,
      },
    },
    summary,
    rows,
  };
}

export async function getSalesReport(user: AuthenticatedUser, period: SalesPeriod, filters: ReportFilters = {}) {
  assertCanViewSalesHistory(user);
  const normalized = normalizeFilters(filters);
  const [orders, bills] = await Promise.all([listOrders(), listBills()]);
  const buckets = new Map<string, SalesReportRow>();

  for (const order of orders.filter((row) => orderMatchesFilters(row, normalized, bills))) {
    const key = periodKey(order.createdAt, period);
    const bucket = buckets.get(key) ?? {
      periodStart: key,
      periodLabel: key,
      orderCount: 0,
      quantitySold: 0,
      revenue: 0,
      metrics: emptySalesMetrics(),
      invoiceCount: 0,
      invoiceTotal: 0,
      invoices: [],
      items: [],
    };
    if (order.status === 'cancelled') {
      bucket.metrics.cancelledOrderCount += 1;
      bucket.metrics.cancelledOrderValue = roundMoney(bucket.metrics.cancelledOrderValue + order.items.reduce((sum, item) => sum + lineRevenue(item), 0));
      buckets.set(key, bucket);
      continue;
    }
    bucket.orderCount += 1;

    for (const item of order.items) {
      bucket.quantitySold = roundQuantity(bucket.quantitySold + item.quantity);
      bucket.revenue = roundMoney(bucket.revenue + lineRevenue(item));
      bucket.metrics.grossOrderedSales = roundMoney(bucket.metrics.grossOrderedSales + lineRevenue(item));
      const drilldown = bucket.items.find((row) => row.menuItemId === item.menuItemId) ?? {
        menuItemId: item.menuItemId,
        itemName: item.name,
        quantitySold: 0,
        grossSales: 0,
        orderIds: [],
      };
      drilldown.quantitySold = roundQuantity(drilldown.quantitySold + item.quantity);
      drilldown.grossSales = roundMoney(drilldown.grossSales + lineRevenue(item));
      if (!drilldown.orderIds.includes(order.id)) drilldown.orderIds.push(order.id);
      if (!bucket.items.includes(drilldown)) bucket.items.push(drilldown);
    }

    buckets.set(key, bucket);
  }

  for (const bill of bills.filter((row) => billMatchesFilters(row, normalized, orders))) {
    const key = periodKey(bill.updatedAt, period);
    const bucket = buckets.get(key) ?? {
      periodStart: key,
      periodLabel: key,
      orderCount: 0,
      quantitySold: 0,
      revenue: 0,
      metrics: emptySalesMetrics(),
      invoiceCount: 0,
      invoiceTotal: 0,
      invoices: [],
      items: [],
    };
    const invoice = salesInvoiceRow(bill);
    bucket.invoiceCount += 1;
    bucket.invoiceTotal = roundMoney(bucket.invoiceTotal + invoice.amount);
    bucket.invoices.push(invoice);
    const ledger = ledgerAmounts(bill, normalized);
    bucket.metrics.collectedPayments = roundMoney(bucket.metrics.collectedPayments + ledger.collectedPayments);
    bucket.metrics.refunds = roundMoney(bucket.metrics.refunds + ledger.refunds);
    bucket.metrics.voids = roundMoney(bucket.metrics.voids + ledger.voids);
    if (bill.state !== 'void') {
      const splits = flattenBillSplits(bill).filter((split) => split.state !== 'void');
      const gross = splits.reduce((sum, split) => sum + split.subtotal, 0);
      const discounts = splits.reduce((sum, split) => sum + split.discountTotal, 0);
      const tax = splits.reduce((sum, split) => sum + split.taxTotal, 0);
      bucket.metrics.discounts = roundMoney(bucket.metrics.discounts + discounts);
      bucket.metrics.tax = roundMoney(bucket.metrics.tax + tax);
      bucket.metrics.netSales = roundMoney(bucket.metrics.netSales + gross - discounts);
      bucket.metrics.recognizedRevenue = roundMoney(bucket.metrics.recognizedRevenue + gross - discounts + tax);
      bucket.metrics.outstandingBalance = roundMoney(bucket.metrics.outstandingBalance + splits.reduce((sum, split) => sum + split.unpaidBalance, 0));
    }
    buckets.set(key, bucket);
  }

  const rows = [...buckets.values()]
    .map((row) => ({ ...row, invoices: row.invoices.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)) }))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  return makeReport(
    `sales_by_${period}`,
    `sales_by_${period}`,
    normalized,
    [
      { key: 'periodLabel', label: t(normalized.locale, 'reportHeadings', 'period'), type: 'date' },
      { key: 'orderCount', label: t(normalized.locale, 'reportHeadings', 'orders'), type: 'number' },
      { key: 'quantitySold', label: t(normalized.locale, 'reportHeadings', 'quantity_sold'), type: 'number' },
      { key: 'revenue', label: t(normalized.locale, 'reportHeadings', 'revenue'), type: 'currency' },
    ],
    rows,
    (() => {
      const metrics = rows.reduce<ReportSalesMetrics>((total, row) => {
        for (const key of Object.keys(total) as Array<keyof ReportSalesMetrics>) total[key] = roundMoney(total[key] + row.metrics[key]);
        return total;
      }, emptySalesMetrics());
      return {
      orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
      quantitySold: roundQuantity(rows.reduce((sum, row) => sum + row.quantitySold, 0)),
      revenue: roundMoney(rows.reduce((sum, row) => sum + row.revenue, 0)),
      invoiceCount: rows.reduce((sum, row) => sum + row.invoiceCount, 0),
      invoiceTotal: roundMoney(rows.reduce((sum, row) => sum + row.invoiceTotal, 0)),
      ...metrics,
      };
    })(),
  );
}

/** A close-of-day view calculated from invoice splits and their payment ledgers. */
export async function getDailySummaryReport(user: AuthenticatedUser, filters: ReportFilters = {}): Promise<ExportReadyReport<DailySummary, Array<{ section: string; metric: string; amount: number }>[number]>> {
  assertCanViewReports(user);
  const normalized = normalizeFilters(filters);
  const [allOrders, allBills] = await Promise.all([listOrders(), listBills()]);
  const orders = allOrders.filter((order) => {
    if (!orderMatchesFilters(order, normalized, allBills)) return false;
    if (normalized.serviceMode && order.serviceMode !== normalized.serviceMode) return false;
    return matchesOptionalField(order, 'shiftId', normalized.shiftId);
  });
  const orderIds = new Set(orders.map((order) => order.id));
  const bills = allBills.filter((bill) => {
    if (!billMatchesFilters(bill, normalized, allOrders)) return false;
    const related = billOrders(bill, allOrders);
    if ((normalized.serviceMode || normalized.waiterUserId || normalized.shiftId) && !related.some((order) => orderIds.has(order.id))) return false;
    if (normalized.shiftId && !matchesOptionalField(bill, 'shiftId', normalized.shiftId) && !related.some((order) => matchesOptionalField(order, 'shiftId', normalized.shiftId))) return false;
    if (normalized.paymentMethod) {
      return flattenBillSplits(bill).some((split) => split.payments.some((payment) => payment.method === normalized.paymentMethod && isWithinRange(payment.paidAt, normalized)));
    }
    return true;
  });

  const summary: DailySummary = {
    businessDate: filters.businessDate ?? (normalized.dateFrom === DEFAULT_REPORT_START ? getBusinessDate(new Date().toISOString(), getRuntimeSettings().branch) : getBusinessDate(normalized.dateFrom, getRuntimeSettings().branch)),
    branchId: normalized.branchId,
    grossSales: 0,
    discounts: { itemLevel: 0, combo: 0, happyHour: 0, billLevel: 0, total: 0 },
    tax: 0,
    serviceCharges: 0,
    netSales: 0,
    paymentTotals: {},
    refunds: 0,
    voids: 0,
    debts: 0,
    outstandingBalances: 0,
    orderCount: orders.filter((order) => order.status !== 'cancelled').length,
    invoiceCount: bills.filter((bill) => bill.state !== 'void').length,
    averageCheck: 0,
    tenderedTotal: 0,
    tenderVariance: 0,
  };
  let guestCount = 0;
  let hasGuestCount = false;
  for (const order of orders.filter((row) => row.status !== 'cancelled')) {
    const guests = Number((order as unknown as Record<string, unknown>).guestCount);
    if (Number.isFinite(guests)) { guestCount += guests; hasGuestCount = true; }
  }
  if (hasGuestCount) summary.guestCount = guestCount;

  const transactionTimes: string[] = [];
  let paymentVoids = 0;
  for (const bill of bills) {
    const splits = flattenBillSplits(bill);
    if (bill.state === 'void') summary.voids += billTotalDue(bill);
    for (const split of splits.filter((row) => row.state !== 'void' && bill.state !== 'void')) {
      const breakdown = split.calculationBreakdown;
      summary.grossSales += split.subtotal;
      summary.discounts.itemLevel += breakdown?.discounts?.itemLevel ?? 0;
      summary.discounts.combo += breakdown?.discounts?.combo ?? 0;
      summary.discounts.happyHour += breakdown?.discounts?.happyHour ?? 0;
      summary.discounts.billLevel += breakdown?.discounts?.billLevel ?? 0;
      summary.discounts.total += split.discountTotal;
      summary.tax += split.taxTotal;
      const serviceCharge = Number((split as unknown as Record<string, unknown>).serviceChargeTotal ?? (breakdown as unknown as Record<string, unknown> | undefined)?.serviceChargeTotal ?? 0);
      summary.serviceCharges += Number.isFinite(serviceCharge) ? serviceCharge : 0;
      summary.outstandingBalances += split.unpaidBalance;
      if (bill.state === 'debt' || split.state === 'debt') summary.debts += split.unpaidBalance;
    }
    for (const payment of splits.flatMap((split) => split.payments)) {
      if (!isWithinRange(payment.paidAt, normalized) || (normalized.cashierUserId && payment.receivedByUserId !== normalized.cashierUserId) || (normalized.paymentMethod && payment.method !== normalized.paymentMethod) || payment.status === 'failed' || payment.status === 'authorized') continue;
      transactionTimes.push(payment.paidAt);
      const type = payment.type ?? 'payment';
      if (type === 'refund') summary.refunds += payment.amount;
      else if (type === 'void') { summary.voids += payment.amount; paymentVoids += payment.amount; }
      else if (payment.status !== 'voided') summary.paymentTotals[payment.method] = (summary.paymentTotals[payment.method] ?? 0) + payment.amount;
    }
  }
  summary.netSales = summary.grossSales - summary.discounts.total;
  summary.tenderedTotal = Object.values(summary.paymentTotals).reduce((sum, amount) => sum + amount, 0) - summary.refunds - paymentVoids;
  summary.tenderVariance = summary.tenderedTotal - (summary.netSales + summary.tax + summary.serviceCharges - summary.outstandingBalances);
  summary.averageCheck = summary.invoiceCount ? summary.netSales / summary.invoiceCount : 0;
  for (const key of ['grossSales', 'tax', 'serviceCharges', 'netSales', 'refunds', 'voids', 'debts', 'outstandingBalances', 'averageCheck', 'tenderedTotal', 'tenderVariance'] as const) summary[key] = roundMoney(summary[key]);
  for (const key of Object.keys(summary.discounts) as Array<keyof typeof summary.discounts>) summary.discounts[key] = roundMoney(summary.discounts[key]);
  for (const method of Object.keys(summary.paymentTotals)) summary.paymentTotals[method] = roundMoney(summary.paymentTotals[method]);
  transactionTimes.sort();
  summary.firstTransactionAt = transactionTimes[0];
  summary.lastTransactionAt = transactionTimes[transactionTimes.length - 1];

  const rows = [
    { section: 'sales', metric: 'Gross sales', amount: summary.grossSales },
    ...Object.entries(summary.discounts).filter(([key]) => key !== 'total').map(([metric, amount]) => ({ section: 'discounts', metric, amount })),
    { section: 'sales', metric: 'Tax', amount: summary.tax }, { section: 'sales', metric: 'Service charges', amount: summary.serviceCharges },
    { section: 'sales', metric: 'Net sales', amount: summary.netSales },
    ...Object.entries(summary.paymentTotals).map(([metric, amount]) => ({ section: 'payments', metric, amount })),
    { section: 'payments', metric: 'Refunds', amount: summary.refunds }, { section: 'payments', metric: 'Voids', amount: summary.voids },
    { section: 'balances', metric: 'Debts', amount: summary.debts }, { section: 'balances', metric: 'Outstanding balances', amount: summary.outstandingBalances },
  ];
  return makeReport('daily_summary', 'sales_by_day', normalized, [
    { key: 'section', label: 'Section', type: 'string' }, { key: 'metric', label: 'Metric', type: 'string' }, { key: 'amount', label: 'Amount', type: 'currency' },
  ], rows, summary);
}

function stockBalanceBefore(movements: StockMovementRecord[], dateFrom: string): number {
  return roundQuantity(movements.filter((row) => row.createdAt < dateFrom).reduce((sum, row) => sum + row.quantityDelta, 0));
}

function movementCost(movement: StockMovementRecord): number {
  const row = movement as StockMovementRecord & { unitCost?: number; totalCost?: number };
  if (typeof row.totalCost === 'number') return Math.abs(row.totalCost);
  if (typeof row.unitCost === 'number') return Math.abs(movement.quantityDelta) * row.unitCost;
  return 0;
}

export async function getInventoryUsageReport(user: AuthenticatedUser, filters: ReportFilters = {}) {
  assertCanViewReports(user);
  const normalized = normalizeFilters(filters);
  const [items, movements] = await Promise.all([listInventoryItems(), listStockMovements()]);

  const rows = items.filter((item) => matchesBranch(item, normalized)).map((item: InventoryItemRecord): InventoryUsageReportRow => {
    const itemMovements = movements.filter((movement) => movement.itemId === item.id);
    const openingStock = stockBalanceBefore(itemMovements, normalized.dateFrom);
    let balance = openingStock;
    const trend: InventoryUsageReportRow['trend'] = [];
    let restocked = 0;
    let used = 0;
    let wastage = 0;
    let manualAdjustments = 0;

    for (const movement of itemMovements.filter((row) => isWithinRange(row.createdAt, normalized))) {
      balance = roundQuantity(balance + movement.quantityDelta);
      if (movement.movementType === 'restock') restocked = roundQuantity(restocked + movement.quantityDelta);
      if (movement.movementType === 'sale_deduction') used = roundQuantity(used + Math.abs(movement.quantityDelta));
      if (movement.movementType === 'wastage') wastage = roundQuantity(wastage + Math.abs(movement.quantityDelta));
      if (movement.movementType === 'manual_adjustment') manualAdjustments = roundQuantity(manualAdjustments + movement.quantityDelta);
      trend.push({
        at: movement.createdAt,
        movementType: movement.movementType,
        quantityDelta: movement.quantityDelta,
        balanceAfter: balance,
        referenceId: movement.referenceId,
      });
    }

    return {
      itemId: item.id,
      sku: item.sku,
      itemName: item.name,
      unit: item.unit,
      openingStock,
      restocked,
      used,
      wastage,
      manualAdjustments,
      closingStock: balance,
      trend,
    };
  });

  return makeReport(
    'inventory_usage_stock_trend',
    'inventory_usage_stock_trend',
    normalized,
    [
      { key: 'sku', label: t(normalized.locale, 'reportHeadings', 'sku'), type: 'string' },
      { key: 'itemName', label: t(normalized.locale, 'reportHeadings', 'item'), type: 'string' },
      { key: 'unit', label: t(normalized.locale, 'reportHeadings', 'unit'), type: 'string' },
      { key: 'openingStock', label: t(normalized.locale, 'reportHeadings', 'opening_stock'), type: 'number' },
      { key: 'restocked', label: t(normalized.locale, 'reportHeadings', 'restocked'), type: 'number' },
      { key: 'used', label: t(normalized.locale, 'reportHeadings', 'used'), type: 'number' },
      { key: 'wastage', label: t(normalized.locale, 'reportHeadings', 'wastage'), type: 'number' },
      { key: 'manualAdjustments', label: t(normalized.locale, 'reportHeadings', 'manual_adjustments'), type: 'number' },
      { key: 'closingStock', label: t(normalized.locale, 'reportHeadings', 'closing_stock'), type: 'number' },
    ],
    rows,
    {
      itemCount: rows.length,
      totalUsed: roundQuantity(rows.reduce((sum, row) => sum + row.used, 0)),
      totalWastage: roundQuantity(rows.reduce((sum, row) => sum + row.wastage, 0)),
    },
  );
}

export async function getFinancialSummaryReport(user: AuthenticatedUser, filters: ReportFilters = {}) {
  assertCanViewReports(user);
  const normalized = normalizeFilters(filters);
  const [bills, movements, orders, sales] = await Promise.all([listBills(), listStockMovements(), listOrders(), getSalesReport(user, 'day', filters)]);
  const matchedBills = bills.filter((bill) => billMatchesFilters(bill, normalized, orders));
  // Cash revenue is a ledger measure; totalDue is recognized revenue and can remain unpaid.
  const revenue = sales.summary.collectedPayments;
  const cogs = roundMoney(
    movements
      .filter((movement) => movement.movementType === 'sale_deduction' && isWithinRange(movement.createdAt, normalized) && matchesBranch(movement, normalized))
      .reduce((sum, movement) => sum + movementCost(movement), 0),
  );
  const grossProfit = roundMoney(revenue - cogs);
  const grossMarginPercent = revenue === 0 ? 0 : roundMoney((grossProfit / revenue) * 100);
  const rows: FinancialSummaryRow[] = [
    { metric: 'revenue', amount: revenue },
    { metric: 'grossOrderedSales', amount: sales.summary.grossOrderedSales },
    { metric: 'discounts', amount: sales.summary.discounts },
    { metric: 'tax', amount: sales.summary.tax },
    { metric: 'netSales', amount: sales.summary.netSales },
    { metric: 'collectedPayments', amount: sales.summary.collectedPayments },
    { metric: 'refunds', amount: sales.summary.refunds },
    { metric: 'voids', amount: sales.summary.voids },
    { metric: 'outstandingBalance', amount: sales.summary.outstandingBalance },
    { metric: 'recognizedRevenue', amount: sales.summary.recognizedRevenue },
    { metric: 'cogs', amount: cogs },
    { metric: 'gross_profit', amount: grossProfit },
    { metric: 'gross_margin_percent', amount: grossMarginPercent },
  ];

  return makeReport(
    'financial_summary',
    'financial_summary',
    normalized,
    [
      { key: 'metric', label: t(normalized.locale, 'reportHeadings', 'metric'), type: 'string' },
      { key: 'amount', label: t(normalized.locale, 'reportHeadings', 'amount'), type: 'currency' },
    ],
    rows,
    {
      revenue,
      grossOrderedSales: sales.summary.grossOrderedSales,
      discounts: sales.summary.discounts,
      tax: sales.summary.tax,
      netSales: sales.summary.netSales,
      collectedPayments: sales.summary.collectedPayments,
      refunds: sales.summary.refunds,
      voids: sales.summary.voids,
      outstandingBalance: sales.summary.outstandingBalance,
      recognizedRevenue: sales.summary.recognizedRevenue,
      cogs,
      grossProfit,
      grossMarginPercent,
      billCount: matchedBills.length,
    },
  );
}

function exceptionOrderMatches(order: OrderRecord, filters: NormalizedFilters, bills: BillRecord[]): boolean {
  if (!matchesBranch(order, filters)) return false;
  if (filters.waiterUserId && order.createdBy !== filters.waiterUserId) return false;
  if (filters.shiftId && !matchesOptionalField(order, 'shiftId', filters.shiftId)) return false;
  if (filters.cashierUserId && !bills.some((bill) => billOrders(bill, [order]).length && billCashierIds(bill).has(filters.cashierUserId!))) return false;
  return true;
}

function reportReasonMatches(reason: string | undefined, filter: string | undefined): boolean {
  return !filter || !!reason?.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
}

function auditAmount(event: AuditEventRecord): number {
  const metadataAmount = numericValue(event.metadata, 'amount');
  if (metadataAmount !== undefined) return Math.abs(metadataAmount);
  const beforeBreakdown = valueFrom(valueFrom(event.before, 'calculationBreakdown'), 'totalDue');
  const afterBreakdown = valueFrom(valueFrom(event.after, 'calculationBreakdown'), 'totalDue');
  const before = Number(beforeBreakdown ?? numericValue(event.before, 'amount') ?? numericValue(event.originalValue, 'amount'));
  const after = Number(afterBreakdown ?? numericValue(event.after, 'amount') ?? numericValue(event.finalValue, 'amount'));
  return Number.isFinite(before) && Number.isFinite(after) ? Math.abs(roundMoney(before - after)) : 0;
}

/** Manager-only exception ledger assembled from immutable payment, order-history, and audit facts. */
export async function getExceptionReport(user: AuthenticatedUser, filters: ReportFilters = {}): Promise<ExportReadyReport<ExceptionReportSummary, ExceptionReportRow> & { categories: Record<ExceptionCategory, ExceptionReportRow[]> }> {
  assertCanViewReports(user);
  const normalized = normalizeFilters(filters);
  const [bills, orders, auditEvents] = await Promise.all([listBills(), listOrders(), listAuditEvents({ from: normalized.dateFrom, to: normalized.dateTo })]);
  const rows: ExceptionReportRow[] = [];
  const add = (row: ExceptionReportRow) => {
    if (normalized.eventType && row.category !== normalized.eventType) return;
    if (!reportReasonMatches(row.reason, normalized.reason)) return;
    rows.push(row);
  };

  for (const bill of bills) {
    const relatedOrders = billOrders(bill, orders);
    if (!matchesBranch(bill, normalized) || (normalized.shiftId && !matchesOptionalField(bill, 'shiftId', normalized.shiftId) && !relatedOrders.some((order) => matchesOptionalField(order, 'shiftId', normalized.shiftId)))) continue;
    if (normalized.waiterUserId && !relatedOrders.some((order) => order.createdBy === normalized.waiterUserId)) continue;
    for (const payment of flattenBillSplits(bill).flatMap((split) => split.payments)) {
      if (!isWithinRange(payment.paidAt, normalized) || (normalized.cashierUserId && payment.receivedByUserId !== normalized.cashierUserId)) continue;
      const type = payment.type ?? 'payment';
      if ((type !== 'void' && type !== 'refund') || payment.status === 'failed') continue;
      const order = relatedOrders[0];
      add({
        id: payment.id,
        category: type === 'void' ? 'payment_voids' : 'refunds',
        businessDate: exceptionBusinessDate(payment.paidAt), occurredAt: payment.paidAt, branchId: bill.branchId,
        orderId: order?.id, invoiceId: bill.id, table: bill.tableName ?? order?.tableName ?? bill.tableSessionId,
        itemOrPaymentMethod: payment.method, amount: roundMoney(payment.amount), reason: payment.reason,
        initiatingUserId: payment.receivedByUserId, approvingManagerId: payment.approvedByUserId,
        originalTransactionReference: payment.linkedPaymentId ?? payment.externalReference?.reference,
        originalValue: payment.linkedPaymentId, finalValue: payment,
      });
    }
  }

  for (const order of orders) {
    if (!exceptionOrderMatches(order, normalized, bills)) continue;
    const invoice = bills.find((bill) => billOrders(bill, [order]).length);
    for (const entry of order.changeLog) {
      if (!isWithinRange(entry.at, normalized) || (entry.action !== 'order_cancelled' && entry.action !== 'item_removed')) continue;
      const item = entry.originalValue as Partial<OrderItem> | undefined;
      const category: ExceptionCategory = entry.action === 'order_cancelled' ? 'order_cancellations' : 'item_removals';
      add({ id: `${order.id}:${entry.at}:${entry.action}`, category, businessDate: exceptionBusinessDate(entry.at), occurredAt: entry.at,
        branchId: order.branchId, orderId: order.id, invoiceId: invoice?.id, table: order.tableName ?? order.tableId ?? order.tableSessionId,
        itemOrPaymentMethod: category === 'item_removals' ? String(valueFrom(entry.details, 'itemName') ?? item?.name ?? '') : undefined,
        quantity: category === 'item_removals' ? Number(valueFrom(entry.details, 'quantity') ?? item?.quantity ?? 0) : order.items.reduce((sum, row) => sum + row.quantity, 0),
        amount: roundMoney(category === 'item_removals' ? Number(valueFrom(entry.details, 'amount') ?? item?.lineTotal ?? 0) : Number(valueFrom(entry.originalValue, 'subtotal') ?? order.subtotal)),
        reason: entry.reason ?? optionalRecordField(entry.details, 'reason'), initiatingUserId: entry.actorUserId, approvingManagerId: entry.approverUserId,
        originalTransactionReference: order.id, originalValue: entry.originalValue, finalValue: entry.finalValue });
    }
  }

  const valueChangeActions = new Set(['discount_applied', 'item_comped', 'price_overridden']);
  for (const event of auditEvents.filter((row) => valueChangeActions.has(row.action))) {
    const metadata = event.metadata ?? {};
    const branchId = optionalRecordField(metadata, 'branchId') ?? orders.find((order) => order.id === event.entity.id)?.branchId ?? bills.find((bill) => bill.id === event.entity.id)?.branchId ?? normalized.branchId;
    if (normalized.branchId && branchId !== normalized.branchId) continue;
    const orderId = optionalRecordField(metadata, 'orderId') ?? (event.entity.type === 'order' ? event.entity.id : undefined);
    const order = orders.find((row) => row.id === orderId);
    const bill = bills.find((row) => row.id === event.entity.id || row.tableSessionId === optionalRecordField(metadata, 'tableSessionId'));
    if (normalized.waiterUserId && order?.createdBy !== normalized.waiterUserId) continue;
    if (normalized.shiftId && !matchesOptionalField(order ?? bill, 'shiftId', normalized.shiftId)) continue;
    if (normalized.cashierUserId && event.actor.userId !== normalized.cashierUserId && (!bill || !billCashierIds(bill).has(normalized.cashierUserId))) continue;
    add({ id: event.id, category: 'comps_price_overrides', businessDate: exceptionBusinessDate(event.timestamp), occurredAt: event.timestamp,
      branchId: branchId ?? '', orderId, invoiceId: bill?.id, table: order?.tableName ?? bill?.tableName ?? optionalRecordField(metadata, 'tableSessionId'),
      itemOrPaymentMethod: optionalRecordField(metadata, 'itemName') ?? event.entity.label, quantity: numericValue(metadata, 'quantity'), amount: auditAmount(event), reason: event.reason,
      initiatingUserId: event.actor.userId, approvingManagerId: event.approverUserId ?? optionalRecordField(metadata, 'approverUserId'),
      originalTransactionReference: optionalRecordField(metadata, 'originalTransactionReference') ?? event.entity.id,
      originalValue: event.originalValue ?? event.before, finalValue: event.finalValue ?? event.after });
  }

  rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const categoryTotals = Object.fromEntries((['payment_voids', 'refunds', 'order_cancellations', 'item_removals', 'comps_price_overrides'] as ExceptionCategory[]).map((category) => {
    const categoryRows = rows.filter((row) => row.category === category);
    return [category, { count: categoryRows.length, amount: roundMoney(categoryRows.reduce((sum, row) => sum + row.amount, 0)) }];
  })) as ExceptionReportSummary['categoryTotals'];
  const summary: ExceptionReportSummary = { count: rows.length, amount: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)), categoryTotals,
    reconciliation: { paymentExceptions: roundMoney(categoryTotals.payment_voids.amount + categoryTotals.refunds.amount), cancelledSales: categoryTotals.order_cancellations.amount, itemExceptions: roundMoney(categoryTotals.item_removals.amount + categoryTotals.comps_price_overrides.amount) } };
  const report = makeReport('exception_report', 'exception_report', normalized, [
    { key: 'category', label: 'Event type', type: 'string' }, { key: 'businessDate', label: 'Business date', type: 'date' }, { key: 'occurredAt', label: 'Time', type: 'date' },
    { key: 'branchId', label: 'Branch', type: 'string' }, { key: 'orderId', label: 'Order', type: 'string' }, { key: 'invoiceId', label: 'Invoice', type: 'string' },
    { key: 'table', label: 'Table', type: 'string' }, { key: 'itemOrPaymentMethod', label: 'Item / payment', type: 'string' }, { key: 'quantity', label: 'Quantity', type: 'number' },
    { key: 'amount', label: 'Amount', type: 'currency' }, { key: 'reason', label: 'Reason', type: 'string' }, { key: 'initiatingUserId', label: 'Initiated by', type: 'string' },
    { key: 'approvingManagerId', label: 'Approved by', type: 'string' }, { key: 'originalTransactionReference', label: 'Original reference', type: 'string' },
  ], rows, summary);
  return {
    ...report,
    categories: Object.fromEntries((Object.keys(categoryTotals) as ExceptionCategory[]).map((category) => [category, rows.filter((row) => row.category === category)])) as Record<ExceptionCategory, ExceptionReportRow[]>,
  };
}
