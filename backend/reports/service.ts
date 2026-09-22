import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import { getCurrentBranchId } from '../config/branch';
import { getRuntimeSettings } from '../config/branch';
import { t, normalizeLocale, getTypographyForLocale } from '../i18n/service';
import { listBills, type BillLineItem, type BillRecord, type BillSplit } from '../billing/repository';
import { listInventoryItems, listMenuInventoryRecipes, listStockMovements, type InventoryItemRecord, type StockMovementRecord } from '../inventory/repository';
import { listOrders, type OrderItem, type OrderRecord } from '../orders/repository';
import { listAuditEvents, type AuditEventRecord } from '../audit/repository';
import { getBusinessDate, getBusinessDayRange } from '../../shared/business-day';
import { getPosOperationalSettings } from '../config/posSettings';
import { listCategories, listItems } from '../menu/repository';
import { getKdsPerformanceMetrics, type KdsPerformanceMetrics } from '../kds/service';
import { listKdsProgressHistory } from '../kds/repository';
import { listTableSessions } from '../tables/repository';
import type { OrderStatus } from '../orders/repository';

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
  stationId?: string;
  categoryId?: string;
  category?: string;
  orderStatus?: OrderStatus;
  paymentMethod?: string;
  locale?: string;
  eventType?: ExceptionCategory;
  reason?: string;
  promotionId?: string;
  intervalMinutes?: number;
}

export type ProductMixDimension = 'menu_item' | 'category' | 'station' | 'service_mode' | 'weekday' | 'hour';

export interface ProductMixRow {
  dimension: ProductMixDimension;
  key: string;
  label: string;
  quantity: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  percentageOfTotalSales: number;
  averageSellingPrice: number;
  orderPenetration: number;
  estimatedContributionMargin: number | null;
  estimatedItemCost: number | null;
  costDataStatus: 'complete' | 'missing_recipe' | 'missing_cost';
  orderCount: number;
}

export interface ProductMixSummary {
  quantity: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  orderCount: number;
  missingRecipeItemIds: string[];
  missingCostItemIds: string[];
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
    stationId: string;
    categoryId?: string;
    categoryName?: string;
    category?: string;
    serviceMode: OrderRecord['serviceMode'];
    orderStatus: OrderRecord['status'];
    quantitySold: number;
    grossSales: number;
    orderIds: string[];
  }>;
}

export interface StationSalesRow {
  stationId: string;
  categoryId?: string;
  categoryName: string;
  menuItemId: string;
  itemName: string;
  quantitySold: number;
  grossSales: number;
  orderCount: number;
}

export interface StationReportSummary extends KdsPerformanceMetrics {
  stationId?: string;
  quantitySold: number;
  grossSales: number;
  orderCount: number;
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

export interface InventoryControlRow extends InventoryUsageReportRow {
  unitCost: number | null;
  stockValue: number | null;
  theoreticalUsage: number;
  actualUsage: number;
  usageVariance: number;
  usageVarianceCost: number | null;
  costMappingStatus: 'complete' | 'missing_cost';
}

export interface OperationsReportRow {
  waiterUserId: string;
  orderCount: number;
  guestsServed: number;
  sales: number;
  averageCheck: number;
  voidCancellationCount: number;
  voidCancellationRate: number;
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

function assertCanViewSensitiveReport(user: AuthenticatedUser, action: typeof Actions.ViewFinancialReports | typeof Actions.ViewEmployeePerformanceReports | typeof Actions.ViewVoidReports | typeof Actions.ViewInventoryCostReports, label: string): void {
  if (!can(user, action)) throw new Error(`Forbidden: cannot view ${label} reports.`);
}

function assertCanViewSalesHistory(user: AuthenticatedUser): void {
  if (!can(user, Actions.ViewReports) && !can(user, Actions.ViewSalesHistory) && !can(user, Actions.ViewFinancialReports)) throw new Error('Forbidden: cannot view sales history.');
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
  if (filters.serviceMode && order.serviceMode !== filters.serviceMode) return false;
  if (filters.orderStatus && order.status !== filters.orderStatus) return false;
  if (filters.shiftId && !matchesOptionalField(order, 'shiftId', filters.shiftId)) return false;
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

function productMixTimeParts(at: string, intervalMinutes: number): { weekday: string; hour: string } {
  const timezone = getRuntimeSettings().branch.timezone;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((row) => row.type === type)?.value ?? '';
  const hour = Number(part('hour')) % 24;
  const minute = Number(part('minute'));
  const start = Math.floor((hour * 60 + minute) / intervalMinutes) * intervalMinutes;
  const end = (start + intervalMinutes) % 1440;
  const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return { weekday: part('weekday'), hour: `${clock(start)}–${clock(end)}` };
}

/** Product mix uses immutable order-line names/stations/categories and the actual billed price. */
export async function getProductMixReport(user: AuthenticatedUser, filters: ReportFilters = {}) {
  assertCanViewReports(user);
  const normalized = normalizeFilters(filters);
  const intervalMinutes = Math.min(1440, Math.max(1, Number(filters.intervalMinutes) || 60));
  const [orders, bills, menuItems, categories, recipes, inventoryItems, movements] = await Promise.all([
    listOrders(), listBills(), listItems(), listCategories(), listMenuInventoryRecipes(), listInventoryItems(), listStockMovements(),
  ]);
  const menuById = new Map(menuItems.map((row) => [row.id, row]));
  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const inventoryById = new Map(inventoryItems.map((row) => [row.id, row]));
  const recipesByMenu = new Map<string, typeof recipes>();
  for (const recipe of recipes) recipesByMenu.set(recipe.menuItemId, [...(recipesByMenu.get(recipe.menuItemId) ?? []), recipe]);
  const filteredOrders = orders.filter((order) => orderMatchesFilters(order, normalized, bills));
  const eligibleOrders = filteredOrders.filter((order) => {
    if (!normalized.promotionId || normalized.promotionId === 'promotional') return true;
    const bill = bills.find((row) => row.tableSessionId === order.tableSessionId || row.tableSessionId === order.tableId);
    return !!bill && flattenBillSplits(bill).some((split) => split.calculationBreakdown.appliedPromotions.some((promotion) => promotion.promotionId === normalized.promotionId));
  });
  type Fact = { orderId: string; menuItemId: string; itemName: string; categoryId: string; categoryName: string; station: string; serviceMode: string; weekday: string; hour: string; quantity: number; gross: number; discount: number; net: number; cost: number | null; costStatus: ProductMixRow['costDataStatus'] };
  const facts: Fact[] = [];
  for (const order of eligibleOrders) {
    const bill = bills.find((row) => row.tableSessionId === order.tableSessionId || row.tableSessionId === order.tableId);
    const billLines = bill ? flattenBillSplits(bill).flatMap((split) => split.lineItems) : [];
    const time = productMixTimeParts(order.createdAt, intervalMinutes);
    for (const item of order.items) {
      const current = menuById.get(item.menuItemId);
      const categoryId = item.categoryId ?? current?.categoryId ?? '';
      const categoryName = item.categoryName ?? categoryById.get(categoryId)?.name ?? 'Uncategorized';
      if (normalized.stationId && item.station !== normalized.stationId) continue;
      if (normalized.categoryId && categoryId !== normalized.categoryId) continue;
      if (normalized.category && categoryName.toLowerCase() !== normalized.category.toLowerCase()) continue;
      if (normalized.promotionId === 'promotional' && !(item.isPromotional ?? current?.isPromotional)) continue;
      const gross = roundMoney(item.quantity * item.unitPrice);
      const billed = billLines.find((line) => line.orderItemId === item.id);
      const net = billed ? roundMoney(billed.lineTotal - (billed.lineTax ?? 0)) : roundMoney(item.lineTotal);
      const discount = roundMoney(Math.max(0, gross - net));
      const itemRecipes = recipesByMenu.get(item.menuItemId) ?? [];
      let costStatus: ProductMixRow['costDataStatus'] = itemRecipes.length ? 'complete' : 'missing_recipe';
      let unitCost = 0;
      for (const recipe of itemRecipes) {
        const inventory = inventoryById.get(recipe.inventoryItemId);
        const pricedMovement = movements.filter((movement) => movement.itemId === recipe.inventoryItemId && movement.createdAt <= order.createdAt)
          .reverse().find((movement) => typeof (movement as StockMovementRecord & { unitCost?: number }).unitCost === 'number') as (StockMovementRecord & { unitCost?: number }) | undefined;
        const ingredientCost = inventory?.unitCost ?? pricedMovement?.unitCost;
        if (ingredientCost === undefined) costStatus = 'missing_cost';
        else unitCost += recipe.quantityPerUnit * ingredientCost;
      }
      facts.push({ orderId: order.id, menuItemId: item.menuItemId, itemName: item.name, categoryId, categoryName, station: item.station ?? 'Unassigned', serviceMode: order.serviceMode, ...time,
        quantity: item.quantity, gross, discount, net, cost: costStatus === 'complete' ? roundMoney(unitCost * item.quantity) : null, costStatus });
    }
  }
  const totalNet = roundMoney(facts.reduce((sum, fact) => sum + fact.net, 0));
  const totalOrders = new Set(facts.map((fact) => fact.orderId)).size;
  const dimensions: Array<[ProductMixDimension, (fact: Fact) => [string, string]]> = [
    ['menu_item', (fact) => [fact.menuItemId, fact.itemName]], ['category', (fact) => [fact.categoryId || 'uncategorized', fact.categoryName]],
    ['station', (fact) => [fact.station, fact.station]], ['service_mode', (fact) => [fact.serviceMode, fact.serviceMode.replace('_', ' ')]],
    ['weekday', (fact) => [fact.weekday, fact.weekday]], ['hour', (fact) => [fact.hour, fact.hour]],
  ];
  const groups = Object.fromEntries(dimensions.map(([dimension, identify]) => {
    const buckets = new Map<string, { label: string; facts: Fact[] }>();
    for (const fact of facts) { const [key, label] = identify(fact); const bucket = buckets.get(key) ?? { label, facts: [] }; bucket.facts.push(fact); buckets.set(key, bucket); }
    const rows: ProductMixRow[] = [...buckets].map(([key, bucket]) => {
      const quantity = roundQuantity(bucket.facts.reduce((sum, fact) => sum + fact.quantity, 0));
      const grossSales = roundMoney(bucket.facts.reduce((sum, fact) => sum + fact.gross, 0));
      const discounts = roundMoney(bucket.facts.reduce((sum, fact) => sum + fact.discount, 0));
      const netSales = roundMoney(bucket.facts.reduce((sum, fact) => sum + fact.net, 0));
      const orderCount = new Set(bucket.facts.map((fact) => fact.orderId)).size;
      const costDataStatus: ProductMixRow['costDataStatus'] = bucket.facts.some((fact) => fact.costStatus === 'missing_recipe') ? 'missing_recipe' : bucket.facts.some((fact) => fact.costStatus === 'missing_cost') ? 'missing_cost' : 'complete';
      const estimatedItemCost = costDataStatus === 'complete' ? roundMoney(bucket.facts.reduce((sum, fact) => sum + (fact.cost ?? 0), 0)) : null;
      return { dimension, key, label: bucket.label, quantity, grossSales, discounts, netSales, percentageOfTotalSales: totalNet ? roundMoney(netSales / totalNet * 100) : 0,
        averageSellingPrice: quantity ? roundMoney(netSales / quantity) : 0, orderPenetration: totalOrders ? roundMoney(orderCount / totalOrders * 100) : 0,
        estimatedContributionMargin: estimatedItemCost === null ? null : roundMoney(netSales - estimatedItemCost), estimatedItemCost, costDataStatus, orderCount };
    }).sort((a, b) => b.netSales - a.netSales || a.label.localeCompare(b.label));
    return [dimension, rows];
  })) as Record<ProductMixDimension, ProductMixRow[]>;
  const summary: ProductMixSummary = { quantity: roundQuantity(facts.reduce((sum, fact) => sum + fact.quantity, 0)), grossSales: roundMoney(facts.reduce((sum, fact) => sum + fact.gross, 0)), discounts: roundMoney(facts.reduce((sum, fact) => sum + fact.discount, 0)), netSales: totalNet, orderCount: totalOrders,
    missingRecipeItemIds: [...new Set(facts.filter((fact) => fact.costStatus === 'missing_recipe').map((fact) => fact.menuItemId))], missingCostItemIds: [...new Set(facts.filter((fact) => fact.costStatus === 'missing_cost').map((fact) => fact.menuItemId))] };
  const rows = groups.menu_item;
  return { ...makeReport('product_mix', 'product_mix', normalized, [
    { key: 'label', label: 'Item', type: 'string' }, { key: 'quantity', label: 'Quantity', type: 'number' }, { key: 'grossSales', label: 'Gross sales', type: 'currency' },
    { key: 'discounts', label: 'Discounts', type: 'currency' }, { key: 'netSales', label: 'Net sales', type: 'currency' }, { key: 'percentageOfTotalSales', label: '% total sales', type: 'number' },
    { key: 'averageSellingPrice', label: 'Average selling price', type: 'currency' }, { key: 'orderPenetration', label: 'Order penetration %', type: 'number' },
    { key: 'estimatedContributionMargin', label: 'Estimated contribution margin', type: 'currency' }, { key: 'costDataStatus', label: 'Cost data', type: 'string' },
  ], rows, summary), groups, intervalMinutes };
}

export async function getSalesReport(user: AuthenticatedUser, period: SalesPeriod, filters: ReportFilters = {}) {
  assertCanViewSalesHistory(user);
  const normalized = normalizeFilters(filters);
  const [orders, bills, menuItems, categories] = await Promise.all([listOrders(), listBills(), listItems(), listCategories()]);
  const menuById = new Map(menuItems.map((item) => [item.id, item]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const buckets = new Map<string, SalesReportRow>();

  for (const order of orders.filter((row) => orderMatchesFilters(row, normalized, bills))) {
    const matchingItems = order.items.filter((item) => {
      const menuItem = menuById.get(item.menuItemId);
      const category = menuItem ? categoryById.get(menuItem.categoryId) : undefined;
      return (!normalized.stationId || item.station === normalized.stationId)
        && (!normalized.categoryId || menuItem?.categoryId === normalized.categoryId)
        && (!normalized.category || category?.name.toLowerCase() === normalized.category.toLowerCase());
    });
    if ((normalized.stationId || normalized.categoryId || normalized.category) && !matchingItems.length) continue;
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
      bucket.metrics.cancelledOrderValue = roundMoney(bucket.metrics.cancelledOrderValue + matchingItems.reduce((sum, item) => sum + lineRevenue(item), 0));
      buckets.set(key, bucket);
      continue;
    }
    bucket.orderCount += 1;

    for (const item of matchingItems) {
      const menuItem = menuById.get(item.menuItemId);
      const category = menuItem ? categoryById.get(menuItem.categoryId) : undefined;
      bucket.quantitySold = roundQuantity(bucket.quantitySold + item.quantity);
      bucket.revenue = roundMoney(bucket.revenue + lineRevenue(item));
      bucket.metrics.grossOrderedSales = roundMoney(bucket.metrics.grossOrderedSales + lineRevenue(item));
      const drilldown = bucket.items.find((row) => row.menuItemId === item.menuItemId && row.stationId === item.station && row.serviceMode === order.serviceMode && row.orderStatus === order.status) ?? {
        menuItemId: item.menuItemId,
        itemName: item.name,
        stationId: item.station ?? '',
        categoryId: menuItem?.categoryId,
        categoryName: category?.name,
        category: category?.name,
        serviceMode: order.serviceMode,
        orderStatus: order.status,
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

/** One dynamic endpoint for every configured prep station, with sales and KDS drill-down. */
export async function getStationReport(user: AuthenticatedUser, filters: ReportFilters = {}) {
  assertCanViewReports(user);
  const normalized = normalizeFilters(filters);
  const stations = getPosOperationalSettings().prepStations.filter((station) => station.enabled);
  if (normalized.stationId && !stations.some((station) => station.id === normalized.stationId)) throw new Error('Station is not configured.');
  const sales = await getSalesReport(user, 'day', normalized);
  const rowsByItem = new Map<string, StationSalesRow>();
  for (const period of sales.rows) for (const item of period.items) {
    const key = `${item.stationId}:${item.categoryId ?? ''}:${item.menuItemId}`;
    const row = rowsByItem.get(key) ?? { stationId: item.stationId, categoryId: item.categoryId, categoryName: item.categoryName ?? 'Uncategorized', menuItemId: item.menuItemId, itemName: item.itemName, quantitySold: 0, grossSales: 0, orderCount: 0 };
    row.quantitySold = roundQuantity(row.quantitySold + item.quantitySold);
    row.grossSales = roundMoney(row.grossSales + item.grossSales);
    row.orderCount += item.orderIds.length;
    rowsByItem.set(key, row);
  }
  const rows = [...rowsByItem.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.itemName.localeCompare(b.itemName));
  const metricStations = normalized.stationId ? [normalized.stationId] : stations.map((station) => station.id);
  const metrics = await Promise.all(metricStations.map((station) => getKdsPerformanceMetrics(station, normalized.dateFrom, normalized.dateTo, normalized.branchId)));
  const combined = metrics.reduce<KdsPerformanceMetrics>((total, metric) => ({
    ticketCount: total.ticketCount + metric.ticketCount,
    averagePreparationSeconds: total.averagePreparationSeconds + metric.averagePreparationSeconds,
    p50PreparationSeconds: Math.max(total.p50PreparationSeconds, metric.p50PreparationSeconds),
    p90PreparationSeconds: Math.max(total.p90PreparationSeconds, metric.p90PreparationSeconds),
    p95PreparationSeconds: Math.max(total.p95PreparationSeconds, metric.p95PreparationSeconds),
    longestWaitSeconds: Math.max(total.longestWaitSeconds, metric.longestWaitSeconds), activeBacklog: total.activeBacklog + metric.activeBacklog,
    completedItems: total.completedItems + metric.completedItems, cancellationsAfterPreparation: total.cancellationsAfterPreparation + metric.cancellationsAfterPreparation,
    averageReadyToDeliveredSeconds: total.averageReadyToDeliveredSeconds + metric.averageReadyToDeliveredSeconds,
  }), { ticketCount: 0, averagePreparationSeconds: 0, p50PreparationSeconds: 0, p90PreparationSeconds: 0, p95PreparationSeconds: 0, longestWaitSeconds: 0, activeBacklog: 0, completedItems: 0, cancellationsAfterPreparation: 0, averageReadyToDeliveredSeconds: 0 });
  if (metrics.length) { combined.averagePreparationSeconds = Math.round(combined.averagePreparationSeconds / metrics.length); combined.averageReadyToDeliveredSeconds = Math.round(combined.averageReadyToDeliveredSeconds / metrics.length); }
  const summary: StationReportSummary = { stationId: normalized.stationId, quantitySold: roundQuantity(rows.reduce((sum, row) => sum + row.quantitySold, 0)), grossSales: roundMoney(rows.reduce((sum, row) => sum + row.grossSales, 0)), orderCount: new Set(sales.rows.flatMap((row) => row.items.flatMap((item) => item.orderIds))).size, ...combined };
  return { ...makeReport('station_report', 'station_report', normalized, [
    { key: 'stationId', label: 'Station', type: 'string' }, { key: 'categoryName', label: 'Category', type: 'string' }, { key: 'itemName', label: 'Item', type: 'string' },
    { key: 'quantitySold', label: 'Quantity', type: 'number' }, { key: 'grossSales', label: 'Sales', type: 'currency' }, { key: 'orderCount', label: 'Orders', type: 'number' },
  ], rows, summary), stations };
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
  if (!can(user, Actions.ViewReports) && !can(user, Actions.ViewInventoryCostReports)) throw new Error('Forbidden: cannot view inventory reports.');
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

/** Inventory valuation and usage reconciliation. Unknown mappings remain null and are
 * surfaced as exceptions so managers never mistake incomplete data for a zero cost. */
export async function getInventoryControlReport(user: AuthenticatedUser, filters: ReportFilters = {}) {
  assertCanViewSensitiveReport(user, Actions.ViewInventoryCostReports, 'inventory cost');
  const normalized = normalizeFilters(filters);
  const [base, items, movements, recipes, orders] = await Promise.all([
    getInventoryUsageReport(user, filters), listInventoryItems(), listStockMovements(), listMenuInventoryRecipes(), listOrders(),
  ]);
  const matchedOrders = orders.filter((order) => orderMatchesFilters(order, normalized, []));
  const soldItems = matchedOrders.filter((order) => order.status !== 'cancelled').flatMap((order) => order.items.filter((line) => {
    if (normalized.stationId && line.station !== normalized.stationId) return false;
    if (normalized.categoryId && line.categoryId !== normalized.categoryId) return false;
    if (normalized.category && line.categoryName !== normalized.category) return false;
    return true;
  }));
  const missingRecipeItemIds = [...new Set(soldItems.filter((line) => !recipes.some((recipe) => recipe.menuItemId === line.menuItemId)).map((line) => line.menuItemId))];
  const theoretical = new Map<string, number>();
  for (const line of soldItems) for (const recipe of recipes.filter((row) => row.menuItemId === line.menuItemId)) {
    theoretical.set(recipe.inventoryItemId, roundQuantity((theoretical.get(recipe.inventoryItemId) ?? 0) + line.quantity * recipe.quantityPerUnit));
  }
  const rows: InventoryControlRow[] = base.rows.map((row) => {
    const item = items.find((candidate) => candidate.id === row.itemId)!;
    const unitCost = typeof item.unitCost === 'number' ? item.unitCost : null;
    const theoreticalUsage = theoretical.get(row.itemId) ?? 0;
    const actualUsage = row.used;
    const usageVariance = roundQuantity(actualUsage - theoreticalUsage);
    return { ...row, unitCost, stockValue: unitCost === null ? null : roundMoney(row.closingStock * unitCost), theoreticalUsage, actualUsage, usageVariance,
      usageVarianceCost: unitCost === null ? null : roundMoney(usageVariance * unitCost), costMappingStatus: unitCost === null ? 'missing_cost' : 'complete' };
  });
  const relevantMovements = movements.filter((row) => isWithinRange(row.createdAt, normalized) && matchesBranch(row, normalized) && reportReasonMatches(row.reasonCode ?? row.reason, normalized.reason));
  const restockHistory = relevantMovements.filter((row) => row.movementType === 'restock');
  const wastageByReason = [...new Set(relevantMovements.filter((row) => row.movementType === 'wastage').map((row) => row.reasonCode ?? row.reason ?? 'unspecified'))].map((reason) => {
    const matching = relevantMovements.filter((row) => row.movementType === 'wastage' && (row.reasonCode ?? row.reason ?? 'unspecified') === reason);
    const missingCost = matching.some((movement) => typeof movement.unitCost !== 'number' && typeof items.find((item) => item.id === movement.itemId)?.unitCost !== 'number');
    return { reason, quantity: roundQuantity(matching.reduce((sum, row) => sum + Math.abs(row.quantityDelta), 0)), cost: missingCost ? null : roundMoney(matching.reduce((sum, row) => sum + Math.abs(row.quantityDelta) * (row.unitCost ?? items.find((item) => item.id === row.itemId)!.unitCost!), 0)), missingCost };
  });
  const missingCostItemIds = rows.filter((row) => row.costMappingStatus === 'missing_cost').map((row) => row.itemId);
  const report = makeReport('inventory_control', 'inventory_usage_stock_trend', normalized, [
    { key: 'sku', label: 'SKU', type: 'string' }, { key: 'itemName', label: 'Item', type: 'string' },
    { key: 'closingStock', label: 'Stock', type: 'number' }, { key: 'unitCost', label: 'Unit cost', type: 'currency' },
    { key: 'stockValue', label: 'Stock value', type: 'currency' }, { key: 'theoreticalUsage', label: 'Theoretical usage', type: 'number' },
    { key: 'actualUsage', label: 'Actual usage', type: 'number' }, { key: 'usageVariance', label: 'Variance', type: 'number' },
  ], rows, { totalStockValue: missingCostItemIds.length ? null : roundMoney(rows.reduce((sum, row) => sum + (row.stockValue ?? 0), 0)), missingRecipeItemIds, missingCostItemIds,
    exceptionCount: missingRecipeItemIds.length + missingCostItemIds.length });
  return { ...report, valuation: rows, restockHistory, wastageByReason, usageVariance: rows, exceptions: { missingRecipeItemIds, missingCostItemIds } };
}

export async function getStockValuationReport(user: AuthenticatedUser, filters: ReportFilters = {}) { const report = await getInventoryControlReport(user, filters); return { ...report, rows: report.valuation }; }
export async function getRestockHistoryReport(user: AuthenticatedUser, filters: ReportFilters = {}) { const report = await getInventoryControlReport(user, filters); return { ...report, rows: report.restockHistory }; }
export async function getWastageReport(user: AuthenticatedUser, filters: ReportFilters = {}) { const report = await getInventoryControlReport(user, filters); return { ...report, rows: report.wastageByReason }; }
export async function getUsageVarianceReport(user: AuthenticatedUser, filters: ReportFilters = {}) { const report = await getInventoryControlReport(user, filters); return { ...report, rows: report.usageVariance }; }

export async function getOperationsReport(user: AuthenticatedUser, filters: ReportFilters = {}) {
  assertCanViewSensitiveReport(user, Actions.ViewEmployeePerformanceReports, 'employee performance');
  const normalized = normalizeFilters(filters);
  const [orders, sessions, history] = await Promise.all([listOrders(), listTableSessions(), listKdsProgressHistory()]);
  const matchedOrders = orders.filter((order) => orderMatchesFilters(order, normalized, [])).filter((order) => order.items.some((line) =>
    (!normalized.stationId || line.station === normalized.stationId) && (!normalized.categoryId || line.categoryId === normalized.categoryId) && (!normalized.category || line.categoryName === normalized.category)));
  const sessionOrders = (sessionId: string) => matchedOrders.filter((order) => order.tableSessionId === sessionId || order.tableId === sessionId);
  const matchedSessions = sessions.filter((session) => matchesBranch(session, normalized) && session.openedAt <= normalized.dateTo && (session.closedAt ?? normalized.dateTo) >= normalized.dateFrom && (!normalized.waiterUserId || session.openedByUserId === normalized.waiterUserId));
  const incompleteTimestamps: Array<{ type: string; id: string; detail: string }> = [];
  const durations = { turnover: [] as number[], orderToKitchen: [] as number[], preparation: [] as number[], readyToDelivery: [] as number[] };
  for (const session of matchedSessions) {
    if (session.closedAt) durations.turnover.push(Math.max(0, (Date.parse(session.closedAt) - Date.parse(session.openedAt)) / 1000));
    else incompleteTimestamps.push({ type: 'open_table_session', id: session.id, detail: 'Table session has not been closed.' });
  }
  for (const order of matchedOrders) for (const item of order.items) {
    if (normalized.stationId && item.station !== normalized.stationId) continue;
    const events = history.filter((event) => event.orderId === order.id && event.orderItemId === item.id && matchesBranch(event, normalized));
    const queued = events.find((event) => event.progress === 'queued');
    const preparing = events.find((event) => event.progress === 'preparing') ?? queued;
    const ready = events.find((event) => event.progress === 'ready');
    const served = events.find((event) => event.progress === 'served');
    if (queued) durations.orderToKitchen.push(Math.max(0, (Date.parse(queued.at) - Date.parse(order.createdAt)) / 1000)); else incompleteTimestamps.push({ type: 'missing_kitchen_send', id: `${order.id}:${item.id}`, detail: 'No queued timestamp.' });
    if (preparing && ready) durations.preparation.push(Math.max(0, (Date.parse(ready.at) - Date.parse(preparing.at)) / 1000)); else incompleteTimestamps.push({ type: 'missing_preparation_timestamp', id: `${order.id}:${item.id}`, detail: 'Preparing or ready timestamp is missing.' });
    if (ready && served) durations.readyToDelivery.push(Math.max(0, (Date.parse(served.at) - Date.parse(ready.at)) / 1000)); else if (ready) incompleteTimestamps.push({ type: 'missing_delivery_timestamp', id: `${order.id}:${item.id}`, detail: 'Ready item has no served timestamp.' });
  }
  const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const waiterIds = [...new Set(matchedOrders.map((order) => order.createdBy))];
  const rows: OperationsReportRow[] = waiterIds.map((waiterUserId) => {
    const waiterOrders = matchedOrders.filter((order) => order.createdBy === waiterUserId); const cancelled = waiterOrders.filter((order) => order.status === 'cancelled').length;
    const sales = roundMoney(waiterOrders.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + order.subtotal, 0));
    const guestsServed = matchedSessions.filter((session) => session.openedByUserId === waiterUserId && sessionOrders(session.id).some((order) => order.createdBy === waiterUserId)).reduce((sum, session) => sum + session.guestCount, 0);
    const completedCount = waiterOrders.filter((order) => order.status !== 'cancelled').length;
    return { waiterUserId, orderCount: waiterOrders.length, guestsServed, sales, averageCheck: completedCount ? roundMoney(sales / completedCount) : 0, voidCancellationCount: cancelled, voidCancellationRate: waiterOrders.length ? roundMoney(cancelled / waiterOrders.length * 100) : 0 };
  });
  const guestsServed = matchedSessions.reduce((sum, session) => sum + session.guestCount, 0); const sales = roundMoney(matchedOrders.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + order.subtotal, 0));
  return makeReport('operations', 'operations', normalized, [
    { key: 'waiterUserId', label: 'Waiter', type: 'string' }, { key: 'orderCount', label: 'Orders', type: 'number' }, { key: 'guestsServed', label: 'Guests', type: 'number' },
    { key: 'sales', label: 'Sales', type: 'currency' }, { key: 'averageCheck', label: 'Average check', type: 'currency' }, { key: 'voidCancellationRate', label: 'Void/cancellation %', type: 'number' },
  ], rows, { tableSessions: matchedSessions.length, openTableSessions: matchedSessions.filter((session) => session.status === 'open' || !session.closedAt).length, guestsServed, sales,
    averageCheck: matchedOrders.filter((order) => order.status !== 'cancelled').length ? roundMoney(sales / matchedOrders.filter((order) => order.status !== 'cancelled').length) : 0,
    averageTableTurnoverSeconds: average(durations.turnover), averageOrderToKitchenSendSeconds: average(durations.orderToKitchen), averagePreparationSeconds: average(durations.preparation), averageReadyToDeliverySeconds: average(durations.readyToDelivery), incompleteTimestamps });
}

export async function getFinancialSummaryReport(user: AuthenticatedUser, filters: ReportFilters = {}) {
  assertCanViewSensitiveReport(user, Actions.ViewFinancialReports, 'financial');
  const normalized = normalizeFilters(filters);
  const [bills, movements, orders, sales, inventoryControl] = await Promise.all([listBills(), listStockMovements(), listOrders(), getSalesReport(user, 'day', filters), getInventoryControlReport(user, filters)]);
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
      costDataStatus: inventoryControl.summary.exceptionCount ? 'incomplete' : 'complete',
      missingRecipeItemIds: inventoryControl.summary.missingRecipeItemIds,
      missingCostItemIds: inventoryControl.summary.missingCostItemIds,
      /** COGS is a partial estimate when mappings are incomplete; never interpret it as complete zero cost. */
      cogsIsEstimate: inventoryControl.summary.exceptionCount > 0,
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
  assertCanViewSensitiveReport(user, Actions.ViewVoidReports, 'void and exception');
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
