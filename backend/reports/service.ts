import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import { getCurrentBranchId } from '../config/branch';
import { t, normalizeLocale, getTypographyForLocale } from '../i18n/service';
import { listBills, type BillLineItem, type BillRecord, type BillSplit } from '../billing/repository';
import { listInventoryItems, listStockMovements, type InventoryItemRecord, type StockMovementRecord } from '../inventory/repository';
import { listOrders, type OrderItem, type OrderRecord } from '../orders/repository';

export type SalesPeriod = 'day' | 'week' | 'month';
export type ReportExportFormat = 'csv' | 'print';

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  cashierUserId?: string;
  waiterUserId?: string;
  locale?: string;
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
  metric: 'revenue' | 'cogs' | 'gross_profit' | 'gross_margin_percent';
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
  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom).toISOString() : DEFAULT_REPORT_START;
  const dateTo = filters.dateTo ? new Date(filters.dateTo).toISOString() : DEFAULT_REPORT_END;
  if (dateFrom > dateTo) throw new Error('dateFrom must be before or equal to dateTo.');

  return {
    ...filters,
    locale: normalizeLocale(filters.locale),
    branchId: filters.branchId ?? getCurrentBranchId(),
    dateFrom,
    dateTo,
  };
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
  const date = new Date(dateIso);
  if (period === 'day') return date.toISOString().slice(0, 10);
  if (period === 'month') return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

  const weekDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = weekDate.getUTCDay() || 7;
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((weekDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${weekDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
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
      invoiceCount: 0,
      invoiceTotal: 0,
      invoices: [],
      items: [],
    };
    bucket.orderCount += 1;

    for (const item of order.items) {
      bucket.quantitySold = roundQuantity(bucket.quantitySold + item.quantity);
      bucket.revenue = roundMoney(bucket.revenue + lineRevenue(item));
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
      invoiceCount: 0,
      invoiceTotal: 0,
      invoices: [],
      items: [],
    };
    const invoice = salesInvoiceRow(bill);
    bucket.invoiceCount += 1;
    bucket.invoiceTotal = roundMoney(bucket.invoiceTotal + invoice.amount);
    bucket.invoices.push(invoice);
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
    {
      orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
      quantitySold: roundQuantity(rows.reduce((sum, row) => sum + row.quantitySold, 0)),
      revenue: roundMoney(rows.reduce((sum, row) => sum + row.revenue, 0)),
      invoiceCount: rows.reduce((sum, row) => sum + row.invoiceCount, 0),
      invoiceTotal: roundMoney(rows.reduce((sum, row) => sum + row.invoiceTotal, 0)),
    },
  );
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

function billRevenue(bill: BillRecord): number {
  return roundMoney(flattenBillSplits(bill).reduce((sum, split) => sum + split.totalDue, 0));
}

export async function getFinancialSummaryReport(user: AuthenticatedUser, filters: ReportFilters = {}) {
  assertCanViewReports(user);
  const normalized = normalizeFilters(filters);
  const [bills, movements, orders] = await Promise.all([listBills(), listStockMovements(), listOrders()]);
  const matchedBills = bills.filter((bill) => billMatchesFilters(bill, normalized, orders));
  const revenue = roundMoney(matchedBills.reduce((sum, bill) => sum + billRevenue(bill), 0));
  const cogs = roundMoney(
    movements
      .filter((movement) => movement.movementType === 'sale_deduction' && isWithinRange(movement.createdAt, normalized) && matchesBranch(movement, normalized))
      .reduce((sum, movement) => sum + movementCost(movement), 0),
  );
  const grossProfit = roundMoney(revenue - cogs);
  const grossMarginPercent = revenue === 0 ? 0 : roundMoney((grossProfit / revenue) * 100);
  const rows: FinancialSummaryRow[] = [
    { metric: 'revenue', amount: revenue },
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
      cogs,
      grossProfit,
      grossMarginPercent,
      billCount: matchedBills.length,
    },
  );
}
