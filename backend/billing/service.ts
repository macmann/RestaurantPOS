import { recordAuditEvent } from '../audit/service';
import { getCurrentBranchId } from '../config/branch';
import { getPosOperationalSettings } from '../config/posSettings';
import { requireOpenTableSession } from '../tables/service';
import { withTransaction } from '../db/client';
import { getLocaleResource, getTypographyForLocale, normalizeLocale } from '../i18n/service';
import { applyEnglishMyanmarLocalizationMap } from '../i18n/resources';
import { getPaymentTerminalAdapter } from '../integrations/paymentTerminal';
import { getCashDrawerAdapter } from '../hardware/cashDrawer';
import { getReceiptPrinterAdapter, type ReceiptPrintResult } from '../hardware/receiptPrinter';
import {
  appendBillingAuditEntry,
  appendDebtLedgerEntry,
  getBillByTableSessionId,
  saveBill,
  type BillCalculationBreakdown,
  type BillLineCalculationBreakdown,
  type BillLineItem,
  type BillPayment,
  type BillPricingOptions,
  type BillPromotion,
  type BillPromotionApplication,
  type BillRecord,
  type BillingState,
  type PaymentMethod,
  type ReceiptPayload,
  type SplitLabel,
  type TableOrderItem,
  type ReceiptLabelKey,
} from './repository';

const SPLIT_LABELS: SplitLabel[] = ['A', 'B', 'C'];
const DEFAULT_PRICING: BillPricingOptions = { taxMode: 'taxable', taxRate: 0, billPromotions: [] };
const ROUNDING_STRATEGY: BillCalculationBreakdown['roundingStrategy'] = 'round-half-up-to-cent-at-each-monetary-step';
const RECEIPT_LABEL_KEYS: ReceiptLabelKey[] = ['receipt', 'table_session', 'total_paid', 'balance_due', 'split', 'subtotal', 'discount', 'tax', 'total_due'];

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertNonNegativeMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
}

function isExternalPaymentMethod(method: PaymentMethod): boolean {
  return method !== 'cash';
}

function getPaymentContribution(payment: BillPayment): number {
  const type = payment.type ?? 'payment';
  if (type === 'refund') return -payment.amount;
  if (type === 'void') return 0;
  if (payment.status === 'voided' || payment.status === 'failed') return 0;
  return payment.amount;
}

function normalizePricing(pricing?: Partial<BillPricingOptions>): BillPricingOptions {
  const configuredTax = getPosOperationalSettings().tax;
  const taxMode = pricing?.taxMode ?? (configuredTax.enabled ? 'taxable' : 'tax_exempt');
  const taxRate = pricing?.taxRate ?? (configuredTax.enabled ? configuredTax.rate : DEFAULT_PRICING.taxRate);
  if (taxMode !== 'taxable' && taxMode !== 'tax_exempt') throw new Error('taxMode must be taxable or tax_exempt.');
  assertNonNegativeMoney(taxRate, 'taxRate');

  return {
    taxMode,
    taxRate: round2(taxRate),
    billPromotions: (pricing?.billPromotions ?? []).map((promotion) => ({
      ...promotion,
      value: round2(promotion.value),
      maxDiscount: typeof promotion.maxDiscount === 'number' ? round2(promotion.maxDiscount) : undefined,
    })),
  };
}

function capDiscount(requested: number, remainingBase: number): number {
  return round2(Math.min(Math.max(requested, 0), Math.max(remainingBase, 0)));
}

function computeLineDiscounts(item: TableOrderItem, gross: number): Pick<BillLineItem, 'itemDiscount' | 'comboDiscount' | 'happyHourDiscount' | 'lineDiscount'> {
  let remaining = gross;
  const itemDiscount = capDiscount(round2(item.itemDiscount ?? item.lineDiscount ?? 0), remaining);
  remaining = round2(remaining - itemDiscount);
  const comboDiscount = capDiscount(round2(item.comboDiscount ?? 0), remaining);
  remaining = round2(remaining - comboDiscount);
  const happyHourDiscount = capDiscount(round2(item.happyHourDiscount ?? 0), remaining);
  const lineDiscount = round2(itemDiscount + comboDiscount + happyHourDiscount);
  return { itemDiscount, comboDiscount, happyHourDiscount, lineDiscount };
}

function computePromotionDiscount(promotion: BillPromotion, baseAmount: number): BillPromotionApplication {
  if (promotion.type !== 'percentage' && promotion.type !== 'fixed_amount') throw new Error(`promotion ${promotion.id} type must be percentage or fixed_amount.`);
  assertNonNegativeMoney(promotion.value, `promotion ${promotion.id} value`);
  if (promotion.maxDiscount !== undefined) assertNonNegativeMoney(promotion.maxDiscount, `promotion ${promotion.id} maxDiscount`);

  const rawAmount = promotion.type === 'percentage' ? round2(baseAmount * (promotion.value / 100)) : round2(promotion.value);
  const maxDiscountApplied = promotion.maxDiscount === undefined ? undefined : round2(Math.min(rawAmount, promotion.maxDiscount));
  const cappedByMax = maxDiscountApplied ?? rawAmount;
  const amount = capDiscount(cappedByMax, baseAmount);

  return {
    promotionId: promotion.id,
    name: promotion.name,
    type: promotion.type,
    value: promotion.value,
    baseAmount: round2(baseAmount),
    amount,
    cappedBySubtotal: amount < cappedByMax,
    maxDiscountApplied,
  };
}

function emptyCalculationBreakdown(overrides?: Partial<BillCalculationBreakdown>): BillCalculationBreakdown {
  return {
    subtotal: 0,
    discounts: { itemLevel: 0, combo: 0, happyHour: 0, billLevel: 0, total: 0 },
    taxableSubtotal: 0,
    taxMode: DEFAULT_PRICING.taxMode,
    taxRate: DEFAULT_PRICING.taxRate,
    taxTotal: 0,
    totalDue: 0,
    roundingStrategy: ROUNDING_STRATEGY,
    appliedPromotions: [],
    lines: [],
    ...overrides,
  };
}

function calculateLineItem(item: TableOrderItem, billLevelTaxEnabled: boolean): BillLineItem {
  const gross = round2(item.quantity * item.unitPrice);
  const discounts = computeLineDiscounts(item, gross);
  const netBeforeBillDiscount = round2(gross - discounts.lineDiscount);
  const legacyLineTax = billLevelTaxEnabled ? 0 : round2(item.lineTax ?? 0);
  const lineTotal = round2(netBeforeBillDiscount + legacyLineTax);
  const id = createId('bill_item');
  const calculation: BillLineCalculationBreakdown = {
    lineItemId: id,
    orderItemId: item.id,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    gross,
    discounts: {
      itemLevel: discounts.itemDiscount,
      combo: discounts.comboDiscount,
      happyHour: discounts.happyHourDiscount,
    },
    netBeforeBillDiscount,
    tax: legacyLineTax,
    lineTotal,
  };

  return {
    id,
    orderItemId: item.id,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    itemDiscount: discounts.itemDiscount,
    comboDiscount: discounts.comboDiscount,
    happyHourDiscount: discounts.happyHourDiscount,
    lineDiscount: discounts.lineDiscount,
    lineTax: legacyLineTax,
    lineTotal,
    calculation,
  };
}

function calculateLineDiscountBreakdown(lineItems: BillLineItem[], pricing: BillPricingOptions): BillCalculationBreakdown {
  const subtotal = round2(lineItems.reduce((sum, item) => sum + item.calculation.gross, 0));
  const itemLevel = round2(lineItems.reduce((sum, item) => sum + item.itemDiscount, 0));
  const combo = round2(lineItems.reduce((sum, item) => sum + item.comboDiscount, 0));
  const happyHour = round2(lineItems.reduce((sum, item) => sum + item.happyHourDiscount, 0));
  const taxableSubtotal = round2(subtotal - itemLevel - combo - happyHour);

  return {
    subtotal,
    discounts: {
      itemLevel,
      combo,
      happyHour,
      billLevel: 0,
      total: round2(itemLevel + combo + happyHour),
    },
    taxableSubtotal,
    taxMode: pricing.taxMode,
    taxRate: pricing.taxMode === 'taxable' ? pricing.taxRate : 0,
    taxTotal: 0,
    totalDue: taxableSubtotal,
    roundingStrategy: ROUNDING_STRATEGY,
    appliedPromotions: [],
    lines: lineItems.map((item) => ({ ...item.calculation })),
  };
}

function allocateAmount(total: number, bases: number[]): number[] {
  const baseTotal = round2(bases.reduce((sum, base) => sum + base, 0));
  if (total === 0 || baseTotal === 0) return bases.map(() => 0);

  let allocatedSoFar = 0;
  return bases.map((base, index) => {
    if (index === bases.length - 1) return round2(total - allocatedSoFar);
    const allocated = round2(total * (base / baseTotal));
    allocatedSoFar = round2(allocatedSoFar + allocated);
    return allocated;
  });
}

function applyBillLevelPricing(splits: BillRecord['splits'], pricing: BillPricingOptions): BillRecord['splits'] {
  const baseBreakdowns = Object.fromEntries(
    SPLIT_LABELS.map((label) => [label, calculateLineDiscountBreakdown(splits[label].lineItems, pricing)]),
  ) as Record<SplitLabel, BillCalculationBreakdown>;

  const billPromotionBase = round2(SPLIT_LABELS.reduce((sum, label) => sum + baseBreakdowns[label].taxableSubtotal, 0));
  const appliedPromotions: BillPromotionApplication[] = [];
  let billTaxableSubtotal = billPromotionBase;

  for (const promotion of pricing.billPromotions ?? []) {
    const applied = computePromotionDiscount(promotion, billTaxableSubtotal);
    appliedPromotions.push(applied);
    billTaxableSubtotal = round2(billTaxableSubtotal - applied.amount);
  }

  const billLevelDiscount = round2(appliedPromotions.reduce((sum, promotion) => sum + promotion.amount, 0));
  const discountAllocations = allocateAmount(
    billLevelDiscount,
    SPLIT_LABELS.map((label) => baseBreakdowns[label].taxableSubtotal),
  );
  const splitTaxableSubtotals = SPLIT_LABELS.map((label, index) => round2(baseBreakdowns[label].taxableSubtotal - discountAllocations[index]));
  const billTaxTotal = pricing.taxMode === 'taxable' ? round2(billTaxableSubtotal * (pricing.taxRate / 100)) : 0;
  const taxAllocations = allocateAmount(billTaxTotal, splitTaxableSubtotals);

  return Object.fromEntries(
    SPLIT_LABELS.map((label, index) => {
      const base = baseBreakdowns[label];
      const billLevel = discountAllocations[index];
      const taxableSubtotal = splitTaxableSubtotals[index];
      const taxTotal = taxAllocations[index];
      const calculationBreakdown: BillCalculationBreakdown = {
        ...base,
        discounts: {
          ...base.discounts,
          billLevel,
          total: round2(base.discounts.itemLevel + base.discounts.combo + base.discounts.happyHour + billLevel),
        },
        taxableSubtotal,
        taxMode: pricing.taxMode,
        taxRate: pricing.taxMode === 'taxable' ? pricing.taxRate : 0,
        taxTotal,
        totalDue: round2(taxableSubtotal + taxTotal),
        appliedPromotions: appliedPromotions.map((promotion) => ({
          ...promotion,
          amount: round2(discountAllocations[index] * (promotion.amount / Math.max(billLevelDiscount, 1))),
        })),
      };
      const amountPaid = round2(splits[label].payments.reduce((sum, p) => sum + getPaymentContribution(p), 0));
      const unpaidBalance = round2(Math.max(calculationBreakdown.totalDue - amountPaid, 0));
      const previousState = splits[label].state;
      let state: BillingState = 'open';
      if (calculationBreakdown.totalDue === 0) state = 'paid';
      else if (previousState === 'debt' && unpaidBalance > 0) state = 'debt';
      else if (amountPaid === 0) state = 'open';
      else if (unpaidBalance > 0) state = 'partially_paid';
      else state = 'paid';

      return [
        label,
        {
          ...splits[label],
          subtotal: calculationBreakdown.subtotal,
          discountTotal: calculationBreakdown.discounts.total,
          taxTotal,
          totalDue: calculationBreakdown.totalDue,
          amountPaid,
          unpaidBalance,
          state,
          calculationBreakdown,
        },
      ];
    }),
  ) as unknown as BillRecord['splits'];
}

function mergeBreakdowns(splits: BillRecord['splits'], pricing: BillPricingOptions): BillCalculationBreakdown {
  const splitBreakdowns = SPLIT_LABELS.map((label) => splits[label].calculationBreakdown);
  const promotionTotals = new Map<string, BillPromotionApplication>();
  for (const promotion of splitBreakdowns.flatMap((split) => split.appliedPromotions)) {
    const current = promotionTotals.get(promotion.promotionId);
    promotionTotals.set(promotion.promotionId, current ? { ...current, amount: round2(current.amount + promotion.amount) } : { ...promotion });
  }

  return {
    subtotal: round2(splitBreakdowns.reduce((sum, split) => sum + split.subtotal, 0)),
    discounts: {
      itemLevel: round2(splitBreakdowns.reduce((sum, split) => sum + split.discounts.itemLevel, 0)),
      combo: round2(splitBreakdowns.reduce((sum, split) => sum + split.discounts.combo, 0)),
      happyHour: round2(splitBreakdowns.reduce((sum, split) => sum + split.discounts.happyHour, 0)),
      billLevel: round2(splitBreakdowns.reduce((sum, split) => sum + split.discounts.billLevel, 0)),
      total: round2(splitBreakdowns.reduce((sum, split) => sum + split.discounts.total, 0)),
    },
    taxableSubtotal: round2(splitBreakdowns.reduce((sum, split) => sum + split.taxableSubtotal, 0)),
    taxMode: pricing.taxMode,
    taxRate: pricing.taxMode === 'taxable' ? pricing.taxRate : 0,
    taxTotal: round2(splitBreakdowns.reduce((sum, split) => sum + split.taxTotal, 0)),
    totalDue: round2(splitBreakdowns.reduce((sum, split) => sum + split.totalDue, 0)),
    roundingStrategy: ROUNDING_STRATEGY,
    appliedPromotions: [...promotionTotals.values()],
    lines: splitBreakdowns.flatMap((split) => split.lines),
  };
}

function updateBillStateAndBreakdown(bill: BillRecord): BillRecord {
  bill.splits = applyBillLevelPricing(bill.splits, bill.pricing);
  const splitStates = SPLIT_LABELS.map((label) => bill.splits[label].state);
  bill.state = splitStates.every((x) => x === 'paid') ? 'paid' : splitStates.some((x) => x === 'debt') && splitStates.every((x) => x === 'paid' || x === 'debt') ? 'debt' : splitStates.some((x) => x === 'partially_paid' || x === 'debt') ? 'partially_paid' : 'open';
  bill.calculationBreakdown = mergeBreakdowns(bill.splits, bill.pricing);
  bill.receiptPayload = buildReceiptPayload(bill);
  bill.updatedAt = new Date().toISOString();
  return bill;
}

function buildReceiptPayload(bill: BillRecord, localeInput?: string): ReceiptPayload {
  const totalPaid = round2(SPLIT_LABELS.reduce((sum, label) => sum + bill.splits[label].payments.reduce((paymentSum, payment) => paymentSum + getPaymentContribution(payment), 0), 0));
  const balanceDue = round2(Math.max(bill.calculationBreakdown.totalDue - totalPaid, 0));
  const settings = getPosOperationalSettings();
  const locale = normalizeLocale(localeInput ?? settings.localization.defaultLocale);
  const resource = applyEnglishMyanmarLocalizationMap(getLocaleResource(locale), settings.localization.englishToMyanmar);
  const typography = getTypographyForLocale(locale);
  const receiptCss = `font-family: ${typography.printFontFamily}; direction: ${typography.direction}; unicode-bidi: plaintext;`;

  return {
    receiptId: createId('receipt'),
    restaurant: settings.restaurantBillInfo,
    locale,
    direction: typography.direction,
    fontFamily: typography.fontFamily,
    printFontFamily: typography.printFontFamily,
    unicodeSample: typography.unicodeSample,
    labels: Object.fromEntries(RECEIPT_LABEL_KEYS.map((key) => [key, resource.common[key]])) as Record<ReceiptLabelKey, string>,
    paymentLabels: resource.paymentLabels as ReceiptPayload['paymentLabels'],
    billStatusLabels: resource.billStatuses as ReceiptPayload['billStatusLabels'],
    receiptCss,
    billId: bill.id,
    tableSessionId: bill.tableSessionId,
    generatedAt: new Date().toISOString(),
    splits: SPLIT_LABELS.map((label) => ({
      label,
      lines: bill.splits[label].calculationBreakdown.lines,
      payments: bill.splits[label].payments,
      calculationBreakdown: bill.splits[label].calculationBreakdown,
    })),
    calculationBreakdown: bill.calculationBreakdown,
    totalPaid,
    balanceDue,
  };
}

export async function generateBillFromSessionItems(
  tableSessionId: string,
  itemsBySplit: Partial<Record<SplitLabel, TableOrderItem[]>>,
  actorUserId: string,
  pricingInput?: Partial<BillPricingOptions>,
  branchId = getCurrentBranchId(),
): Promise<BillRecord> {
  const session = await requireOpenTableSession(tableSessionId);
  const now = new Date().toISOString();
  const existing = await getBillByTableSessionId(tableSessionId);
  if (existing) throw new Error(`Bill already exists for table session ${tableSessionId}.`);
  const pricing = normalizePricing(pricingInput);
  for (const item of Object.values(itemsBySplit).flat()) {
    if (item.tableSessionId !== tableSessionId) throw new Error('Bill items must belong to the requested table session.');
  }

  const splits = Object.fromEntries(
    SPLIT_LABELS.map((label) => {
      const sourceItems = itemsBySplit[label] ?? [];
      const lineItems = sourceItems.map((it) => calculateLineItem(it, true));

      return [
        label,
        {
          label,
          lineItems,
          subtotal: 0,
          discountTotal: 0,
          taxTotal: 0,
          totalDue: 0,
          amountPaid: 0,
          unpaidBalance: 0,
          state: 'open',
          payments: [],
          calculationBreakdown: emptyCalculationBreakdown({ taxMode: pricing.taxMode, taxRate: pricing.taxRate }),
        },
      ];
    }),
  ) as unknown as BillRecord['splits'];

  const next: BillRecord = updateBillStateAndBreakdown({
    id: createId('bill'),
    branchId: session.branchId ?? branchId,
    tableSessionId,
    splits,
    state: 'open',
    pricing,
    calculationBreakdown: emptyCalculationBreakdown({ taxMode: pricing.taxMode, taxRate: pricing.taxRate }),
    createdAt: now,
    updatedAt: now,
  });

  await appendBillingAuditEntry({
    id: createId('audit'),
    branchId: session.branchId ?? branchId,
    tableSessionId,
    splitLabel: 'A',
    action: 'bill_generated',
    actorUserId,
    at: now,
    details: {
      splitItemCounts: Object.fromEntries(SPLIT_LABELS.map((x) => [x, splits[x].lineItems.length])),
      pricing: next.pricing,
      discountPrecedence: ['item-level', 'combo', 'happy-hour', 'bill-level'],
      roundingStrategy: ROUNDING_STRATEGY,
    },
  });

  return saveBill(next);
}

export async function setBillTaxMode(input: {
  tableSessionId: string;
  taxMode: BillPricingOptions['taxMode'];
  taxRate?: number;
  actorUserId: string;
}): Promise<BillRecord> {
  const bill = await getBillByTableSessionId(input.tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  const before = structuredClone(bill);

  bill.pricing = normalizePricing({ ...bill.pricing, taxMode: input.taxMode, taxRate: input.taxRate ?? bill.pricing.taxRate });
  updateBillStateAndBreakdown(bill);

  await appendBillingAuditEntry({
    id: createId('audit'),
    branchId: bill.branchId,
    tableSessionId: bill.tableSessionId,
    splitLabel: 'A',
    action: 'bill_tax_mode_changed',
    actorUserId: input.actorUserId,
    at: bill.updatedAt,
    details: { taxMode: bill.pricing.taxMode, taxRate: bill.pricing.taxRate, roundingStrategy: ROUNDING_STRATEGY },
  });
  await recordAuditEvent({
    action: 'tax_toggled',
    actor: { userId: input.actorUserId },
    timestamp: bill.updatedAt,
    entity: { type: 'bill', id: bill.id, label: bill.tableSessionId },
    before: { pricing: before.pricing, calculationBreakdown: before.calculationBreakdown },
    after: { pricing: bill.pricing, calculationBreakdown: bill.calculationBreakdown },
    metadata: { tableSessionId: bill.tableSessionId, roundingStrategy: ROUNDING_STRATEGY },
  });

  return saveBill(bill);
}

export async function applyBillPromotions(input: {
  tableSessionId: string;
  billPromotions: BillPromotion[];
  actorUserId: string;
  reason?: string;
}): Promise<BillRecord> {
  const bill = await getBillByTableSessionId(input.tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  const before = structuredClone(bill);

  bill.pricing = normalizePricing({ ...bill.pricing, billPromotions: input.billPromotions });
  updateBillStateAndBreakdown(bill);

  await appendBillingAuditEntry({
    id: createId('audit'),
    branchId: bill.branchId,
    tableSessionId: bill.tableSessionId,
    splitLabel: 'A',
    action: 'bill_promotions_applied',
    actorUserId: input.actorUserId,
    at: bill.updatedAt,
    details: { promotions: bill.pricing.billPromotions, discountPrecedence: ['item-level', 'combo', 'happy-hour', 'bill-level'] },
  });
  await recordAuditEvent({
    action: 'discount_applied',
    actor: { userId: input.actorUserId },
    timestamp: bill.updatedAt,
    entity: { type: 'bill', id: bill.id, label: bill.tableSessionId },
    before: { pricing: before.pricing, calculationBreakdown: before.calculationBreakdown },
    after: { pricing: bill.pricing, calculationBreakdown: bill.calculationBreakdown },
    reason: input.reason,
    metadata: { tableSessionId: bill.tableSessionId, discountPrecedence: ['item-level', 'combo', 'happy-hour', 'bill-level'] },
  });

  return saveBill(bill);
}

function assertEditableSplit(split: BillRecord['splits'][SplitLabel], label: SplitLabel): void {
  if (split.payments.length > 0 || split.amountPaid > 0) throw new Error(`Split ${label} has payments and cannot be reassigned or merged.`);
}

export async function updateBillSplitItems(input: {
  tableSessionId: string;
  itemsBySplit: Partial<Record<SplitLabel, TableOrderItem[]>>;
  actorUserId: string;
}): Promise<BillRecord> {
  const bill = await getBillByTableSessionId(input.tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  for (const label of SPLIT_LABELS) assertEditableSplit(bill.splits[label], label);
  for (const item of Object.values(input.itemsBySplit).flat()) {
    if (item.tableSessionId !== input.tableSessionId) throw new Error('Bill items must belong to the requested table session.');
  }

  for (const label of SPLIT_LABELS) {
    bill.splits[label] = {
      ...bill.splits[label],
      lineItems: (input.itemsBySplit[label] ?? []).map((it) => calculateLineItem(it, true)),
    };
  }
  updateBillStateAndBreakdown(bill);
  await appendBillingAuditEntry({
    id: createId('audit'),
    branchId: bill.branchId,
    tableSessionId: bill.tableSessionId,
    splitLabel: 'A',
    action: 'bill_split_items_updated',
    actorUserId: input.actorUserId,
    at: bill.updatedAt,
    details: { splitItemCounts: Object.fromEntries(SPLIT_LABELS.map((x) => [x, bill.splits[x].lineItems.length])) },
  });
  return saveBill(bill);
}

export async function mergeBillSplits(input: { tableSessionId: string; actorUserId: string; targetSplitLabel?: SplitLabel }): Promise<BillRecord> {
  const bill = await getBillByTableSessionId(input.tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  const target = input.targetSplitLabel ?? 'A';
  if (!SPLIT_LABELS.includes(target)) throw new Error('Invalid target split label. Use A, B, or C.');
  for (const label of SPLIT_LABELS) assertEditableSplit(bill.splits[label], label);
  const merged = SPLIT_LABELS.flatMap((label) => bill.splits[label].lineItems);
  for (const label of SPLIT_LABELS) bill.splits[label] = { ...bill.splits[label], lineItems: label === target ? merged : [] };
  updateBillStateAndBreakdown(bill);
  await appendBillingAuditEntry({
    id: createId('audit'),
    branchId: bill.branchId,
    tableSessionId: bill.tableSessionId,
    splitLabel: target,
    action: 'bill_splits_merged',
    actorUserId: input.actorUserId,
    at: bill.updatedAt,
    details: { targetSplitLabel: target, mergedLineCount: merged.length },
  });
  return saveBill(bill);
}

export async function voidBill(input: {
  tableSessionId: string;
  actorUserId: string;
  reason: string;
}): Promise<BillRecord> {
  const bill = await getBillByTableSessionId(input.tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  const reason = input.reason.trim();
  if (!reason) throw new Error('A void reason is required.');
  if (bill.state === 'paid') throw new Error('Paid bills cannot be voided.');
  const before = structuredClone(bill);

  for (const label of SPLIT_LABELS) {
    bill.splits[label] = { ...bill.splits[label], state: 'void', totalDue: 0, taxTotal: 0, discountTotal: 0, unpaidBalance: 0 };
  }
  bill.state = 'void';
  bill.pricing = { ...bill.pricing, billPromotions: [] };
  bill.calculationBreakdown = emptyCalculationBreakdown({ taxMode: bill.pricing.taxMode, taxRate: bill.pricing.taxRate });
  bill.receiptPayload = buildReceiptPayload(bill);
  bill.updatedAt = new Date().toISOString();

  await appendBillingAuditEntry({
    id: createId('audit'),
    branchId: bill.branchId,
    tableSessionId: bill.tableSessionId,
    splitLabel: 'A',
    action: 'bill_voided',
    actorUserId: input.actorUserId,
    at: bill.updatedAt,
    details: { reason },
  });
  await recordAuditEvent({
    action: 'bill_voided',
    actor: { userId: input.actorUserId },
    timestamp: bill.updatedAt,
    entity: { type: 'bill', id: bill.id, label: bill.tableSessionId },
    before,
    after: bill,
    reason,
  });

  return saveBill(bill);
}

export async function getBillCalculationBreakdown(tableSessionId: string): Promise<BillCalculationBreakdown> {
  const bill = await getBillByTableSessionId(tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  return bill.calculationBreakdown;
}

export async function getPrintedReceiptPayload(tableSessionId: string, locale?: string): Promise<ReceiptPayload> {
  const bill = await getBillByTableSessionId(tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  return buildReceiptPayload(bill, locale);
}

export async function printBillReceipt(input: {
  tableSessionId: string;
  actorUserId: string;
  locale?: string;
  copies?: number;
  printerId?: string;
}): Promise<ReceiptPrintResult> {
  const bill = await getBillByTableSessionId(input.tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  const payload = buildReceiptPayload(bill, input.locale);
  const printerId = input.printerId ?? getPosOperationalSettings().printers.receipt.printerId;
  const result = await getReceiptPrinterAdapter().printReceipt({ payload, copies: input.copies, printerId });
  bill.receiptPayload = payload;
  await saveBill(bill);
  await appendBillingAuditEntry({
    id: createId('audit'),
    branchId: bill.branchId,
    tableSessionId: bill.tableSessionId,
    splitLabel: 'A',
    action: 'receipt_printed',
    actorUserId: input.actorUserId,
    at: result.printedAt,
    details: { printJobId: result.printJobId, printerId: result.printerId, locale: result.locale, fontFamily: result.fontFamily, copies: result.copyCount },
  });
  return result;
}

export async function recordSplitPayment(input: {
  tableSessionId: string;
  splitLabel: SplitLabel;
  amount: number;
  method: PaymentMethod;
  actorUserId: string;
  paidAt?: string;
  createDebtForUnpaidBalance?: boolean;
}): Promise<BillRecord> {
  return withTransaction(async () => {
    const bill = await getBillByTableSessionId(input.tableSessionId);
    if (!bill) throw new Error('Bill not found for table session.');
    if (!SPLIT_LABELS.includes(input.splitLabel)) throw new Error('Invalid split label. Use A, B, or C.');
    if (input.amount <= 0) throw new Error('Payment amount must be greater than zero.');

    const split = bill.splits[input.splitLabel];
    const beforeSplit = structuredClone(split);
    const paymentId = createId('pay');
    const amount = round2(input.amount);
    const paidAt = input.paidAt ?? new Date().toISOString();
    let payment: BillPayment = {
      id: paymentId,
      branchId: bill.branchId,
      splitLabel: input.splitLabel,
      amount,
      method: input.method,
      paidAt,
      receivedByUserId: input.actorUserId,
      type: 'payment',
      status: 'captured',
    };

    if (isExternalPaymentMethod(input.method)) {
      const adapter = getPaymentTerminalAdapter();
      const idempotencyKey = `${bill.id}:${input.splitLabel}:${paymentId}`;
      const authorization = await adapter.authorize({
        amount,
        currency: 'MMK',
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        billId: bill.id,
        actorUserId: input.actorUserId,
        paymentMethod: input.method,
        idempotencyKey,
      });
      if (authorization.status !== 'authorized') throw new Error(`Payment authorization declined: ${authorization.declineReason ?? authorization.reference}`);
      const capture = await adapter.capture({
        amount,
        currency: 'MMK',
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        billId: bill.id,
        actorUserId: input.actorUserId,
        paymentMethod: input.method,
        idempotencyKey,
        authorizationId: authorization.authorizationId,
      });
      if (capture.status !== 'captured') throw new Error(`Payment capture failed: ${capture.failureReason ?? capture.reference}`);
      payment = {
        ...payment,
        paidAt: capture.capturedAt,
        externalReference: {
          provider: capture.provider,
          rail: authorization.rail,
          authorizationId: authorization.authorizationId,
          captureId: capture.captureId,
          reference: capture.reference,
          raw: { authorization: authorization.raw, capture: capture.raw },
        },
      };
    }

    split.payments.push(payment);

    if (input.method === 'cash') {
      const drawer = await getCashDrawerAdapter().open({
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        billId: bill.id,
        paymentId: payment.id,
        actorUserId: input.actorUserId,
        amount: payment.amount,
        reason: 'cash_payment',
      });
      await appendBillingAuditEntry({
        id: createId('audit'),
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        action: 'cash_drawer_opened',
        actorUserId: input.actorUserId,
        at: drawer.openedAt,
        details: { paymentId: payment.id, amount: payment.amount, drawerId: drawer.drawerId, eventId: drawer.eventId, reason: 'cash_payment' },
      });
      await recordAuditEvent({
        action: 'cash_drawer_opened',
        actor: { userId: input.actorUserId },
        timestamp: drawer.openedAt,
        entity: { type: 'hardware_device', id: drawer.drawerId, label: `${bill.tableSessionId}:${input.splitLabel}` },
        after: drawer,
        metadata: { tableSessionId: bill.tableSessionId, splitLabel: input.splitLabel, paymentId: payment.id, amount: payment.amount },
      });
    }

    bill.splits[input.splitLabel] = split;
    updateBillStateAndBreakdown(bill);

    if (input.createDebtForUnpaidBalance !== false && bill.splits[input.splitLabel].unpaidBalance > 0) {
      const debtEntry = await appendDebtLedgerEntry({
        id: createId('debt'),
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        amount: bill.splits[input.splitLabel].unpaidBalance,
        reason: 'unpaid_balance',
        action: 'debt_created',
        actorUserId: input.actorUserId,
        at: payment.paidAt,
        metadata: { paymentId: payment.id, amountPaid: payment.amount },
      });
      await recordAuditEvent({
        action: 'debt_created',
        actor: { userId: input.actorUserId },
        timestamp: debtEntry.at,
        entity: { type: 'debt_ledger', id: debtEntry.id, label: `${bill.tableSessionId}:${input.splitLabel}` },
        before: { split: beforeSplit, unpaidBalanceBeforePayment: beforeSplit.unpaidBalance },
        after: { debtEntry, split: bill.splits[input.splitLabel] },
        reason: 'unpaid_balance',
        metadata: { tableSessionId: bill.tableSessionId, splitLabel: input.splitLabel, paymentId: payment.id },
      });
      bill.splits[input.splitLabel].state = 'debt';
      updateBillStateAndBreakdown(bill);
    }

    await appendBillingAuditEntry({
      id: createId('audit'),
      branchId: bill.branchId,
      tableSessionId: bill.tableSessionId,
      splitLabel: input.splitLabel,
      action: 'split_payment_recorded',
      actorUserId: input.actorUserId,
      at: payment.paidAt,
      details: { paymentId: payment.id, amount: payment.amount, method: payment.method, status: payment.status, externalReference: payment.externalReference },
    });

    return saveBill(bill);

  });
}

export async function refundSplitPayment(input: {
  tableSessionId: string;
  splitLabel: SplitLabel;
  paymentId: string;
  amount: number;
  actorUserId: string;
  reason: string;
}): Promise<BillRecord> {
  return withTransaction(async () => {
    const bill = await getBillByTableSessionId(input.tableSessionId);
    if (!bill) throw new Error('Bill not found for table session.');
    if (input.amount <= 0) throw new Error('Refund amount must be greater than zero.');
    const reason = input.reason.trim();
    if (!reason) throw new Error('A refund reason is required.');

    const split = bill.splits[input.splitLabel];
    const original = split.payments.find((payment) => payment.id === input.paymentId && (payment.type ?? 'payment') === 'payment');
    if (!original) throw new Error('Original payment not found for split.');
    const alreadyReversed = original.status === 'voided'
      ? original.amount
      : round2(split.payments.filter((payment) => payment.linkedPaymentId === original.id && payment.type === 'refund').reduce((sum, payment) => sum + payment.amount, 0));
    const refundable = round2(original.amount - alreadyReversed);
    const amount = round2(input.amount);
    if (amount > refundable) throw new Error('Refund amount exceeds remaining captured amount.');

    const refundId = createId('refund');
    let refundPayment: BillPayment = {
      id: refundId,
      branchId: bill.branchId,
      splitLabel: input.splitLabel,
      amount,
      method: original.method,
      paidAt: new Date().toISOString(),
      receivedByUserId: input.actorUserId,
      type: 'refund',
      status: 'refunded',
      linkedPaymentId: original.id,
      reason,
    };

    if (isExternalPaymentMethod(original.method)) {
      const captureId = original.externalReference?.captureId;
      if (!captureId) throw new Error('External payment capture reference is required for refund.');
      const refund = await getPaymentTerminalAdapter().refund({
        amount,
        currency: 'MMK',
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        billId: bill.id,
        actorUserId: input.actorUserId,
        paymentMethod: original.method,
        idempotencyKey: `${bill.id}:${input.splitLabel}:${refundId}`,
        captureId,
        originalPaymentId: original.id,
        reason,
      });
      if (refund.status !== 'refunded') throw new Error(`Payment refund failed: ${refund.failureReason ?? refund.reference}`);
      refundPayment = {
        ...refundPayment,
        paidAt: refund.refundedAt,
        externalReference: {
          provider: refund.provider,
          rail: original.externalReference?.rail,
          captureId: refund.captureId,
          refundId: refund.refundId,
          reference: refund.reference,
          raw: refund.raw,
        },
      };
    } else {
      const drawer = await getCashDrawerAdapter().open({
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        billId: bill.id,
        paymentId: refundPayment.id,
        actorUserId: input.actorUserId,
        amount,
        reason: 'cash_refund',
      });
      await appendBillingAuditEntry({
        id: createId('audit'),
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        action: 'cash_drawer_opened',
        actorUserId: input.actorUserId,
        at: drawer.openedAt,
        details: { paymentId: refundPayment.id, amount, drawerId: drawer.drawerId, eventId: drawer.eventId, reason: 'cash_refund' },
      });
    }

    split.payments.push(refundPayment);
    bill.splits[input.splitLabel] = split;
    updateBillStateAndBreakdown(bill);

    await appendBillingAuditEntry({
      id: createId('audit'),
      branchId: bill.branchId,
      tableSessionId: bill.tableSessionId,
      splitLabel: input.splitLabel,
      action: 'split_payment_refunded',
      actorUserId: input.actorUserId,
      at: refundPayment.paidAt,
      details: { paymentId: original.id, refundId: refundPayment.id, amount, method: original.method, externalReference: refundPayment.externalReference, reason },
    });
    await recordAuditEvent({
      action: 'payment_refunded',
      actor: { userId: input.actorUserId },
      timestamp: refundPayment.paidAt,
      entity: { type: 'bill_split', id: `${bill.id}:${input.splitLabel}`, label: `${bill.tableSessionId}:${input.splitLabel}` },
      before: { payment: original, splitAmountPaid: round2(split.amountPaid + amount) },
      after: { refund: refundPayment, split: bill.splits[input.splitLabel] },
      reason,
      metadata: { tableSessionId: bill.tableSessionId, splitLabel: input.splitLabel, paymentId: original.id },
    });

    return saveBill(bill);
  });
}

export async function voidSplitPayment(input: {
  tableSessionId: string;
  splitLabel: SplitLabel;
  paymentId: string;
  actorUserId: string;
  reason: string;
}): Promise<BillRecord> {
  return withTransaction(async () => {
    const bill = await getBillByTableSessionId(input.tableSessionId);
    if (!bill) throw new Error('Bill not found for table session.');
    const reason = input.reason.trim();
    if (!reason) throw new Error('A void reason is required.');
    const split = bill.splits[input.splitLabel];
    const original = split.payments.find((payment) => payment.id === input.paymentId && (payment.type ?? 'payment') === 'payment');
    if (!original) throw new Error('Original payment not found for split.');
    const refundedAmount = round2(split.payments.filter((payment) => payment.linkedPaymentId === original.id && payment.type === 'refund').reduce((sum, payment) => sum + payment.amount, 0));
    if (refundedAmount > 0) throw new Error('Refunded payments cannot be voided; refund the remaining amount instead.');
    const alreadyReversed = split.payments.some((payment) => payment.linkedPaymentId === original.id && payment.type === 'void');
    if (alreadyReversed || original.status === 'voided') throw new Error('Payment has already been voided.');

    const voidId = createId('void');
    let voidPayment: BillPayment = {
      id: voidId,
      branchId: bill.branchId,
      splitLabel: input.splitLabel,
      amount: original.amount,
      method: original.method,
      paidAt: new Date().toISOString(),
      receivedByUserId: input.actorUserId,
      type: 'void',
      status: 'voided',
      linkedPaymentId: original.id,
      reason,
    };

    if (isExternalPaymentMethod(original.method)) {
      const voided = await getPaymentTerminalAdapter().voidPayment({
        branchId: bill.branchId,
        tableSessionId: bill.tableSessionId,
        splitLabel: input.splitLabel,
        billId: bill.id,
        actorUserId: input.actorUserId,
        paymentMethod: original.method,
        idempotencyKey: `${bill.id}:${input.splitLabel}:${voidId}`,
        authorizationId: original.externalReference?.authorizationId,
        captureId: original.externalReference?.captureId,
        originalPaymentId: original.id,
        reason,
      });
      if (voided.status !== 'voided') throw new Error(`Payment void failed: ${voided.failureReason ?? voided.reference}`);
      voidPayment = {
        ...voidPayment,
        paidAt: voided.voidedAt,
        externalReference: {
          provider: voided.provider,
          rail: original.externalReference?.rail,
          authorizationId: original.externalReference?.authorizationId,
          captureId: original.externalReference?.captureId,
          voidId: voided.voidId,
          reference: voided.reference,
          raw: voided.raw,
        },
      };
    }

    original.status = 'voided';
    split.payments.push(voidPayment);
    bill.splits[input.splitLabel] = split;
    updateBillStateAndBreakdown(bill);

    await appendBillingAuditEntry({
      id: createId('audit'),
      branchId: bill.branchId,
      tableSessionId: bill.tableSessionId,
      splitLabel: input.splitLabel,
      action: 'split_payment_voided',
      actorUserId: input.actorUserId,
      at: voidPayment.paidAt,
      details: { paymentId: original.id, voidId: voidPayment.id, amount: original.amount, method: original.method, externalReference: voidPayment.externalReference, reason },
    });
    await recordAuditEvent({
      action: 'payment_voided',
      actor: { userId: input.actorUserId },
      timestamp: voidPayment.paidAt,
      entity: { type: 'bill_split', id: `${bill.id}:${input.splitLabel}`, label: `${bill.tableSessionId}:${input.splitLabel}` },
      before: { payment: { ...original, status: 'captured' } },
      after: { payment: original, void: voidPayment, split: bill.splits[input.splitLabel] },
      reason,
      metadata: { tableSessionId: bill.tableSessionId, splitLabel: input.splitLabel, paymentId: original.id },
    });

    return saveBill(bill);
  });
}

export async function settleDebt(input: {
  tableSessionId: string;
  splitLabel: SplitLabel;
  amount: number;
  actorUserId: string;
  method: PaymentMethod;
  paidAt?: string;
}): Promise<BillRecord> {
  return withTransaction(async () => {
    const beforeBill = await getBillByTableSessionId(input.tableSessionId);
    if (!beforeBill) throw new Error('Bill not found for table session.');
    const bill = await recordSplitPayment({ ...input, createDebtForUnpaidBalance: false });
    const split = bill.splits[input.splitLabel];
    const now = input.paidAt ?? new Date().toISOString();

    const debtEntry = await appendDebtLedgerEntry({
      id: createId('debt'),
      branchId: bill.branchId,
      tableSessionId: input.tableSessionId,
      splitLabel: input.splitLabel,
      amount: round2(input.amount),
      reason: 'settlement_payment',
      action: split.unpaidBalance > 0 ? 'debt_settled_partial' : 'debt_settled_full',
      actorUserId: input.actorUserId,
      at: now,
      metadata: { resultingUnpaidBalance: split.unpaidBalance },
    });
    await recordAuditEvent({
      action: 'debt_settled',
      actor: { userId: input.actorUserId },
      timestamp: debtEntry.at,
      entity: { type: 'debt_ledger', id: debtEntry.id, label: `${input.tableSessionId}:${input.splitLabel}` },
      before: { bill: beforeBill, split: beforeBill.splits[input.splitLabel] },
      after: { debtEntry, split, paymentAmount: round2(input.amount) },
      reason: 'settlement_payment',
      metadata: { tableSessionId: input.tableSessionId, splitLabel: input.splitLabel, method: input.method },
    });

    await appendBillingAuditEntry({
      id: createId('audit'),
      branchId: bill.branchId,
      tableSessionId: input.tableSessionId,
      splitLabel: input.splitLabel,
      action: 'debt_settlement_recorded',
      actorUserId: input.actorUserId,
      at: now,
      details: { amount: input.amount, method: input.method, resultingUnpaidBalance: split.unpaidBalance },
    });

    return bill;
  });
}