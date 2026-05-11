import { recordAuditEvent } from '../audit/service';
import { getCurrentBranchId } from '../config/branch';
import { getLocaleResource, getTypographyForLocale, normalizeLocale } from '../i18n/service';
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

function normalizePricing(pricing?: Partial<BillPricingOptions>): BillPricingOptions {
  const taxMode = pricing?.taxMode ?? DEFAULT_PRICING.taxMode;
  const taxRate = pricing?.taxRate ?? DEFAULT_PRICING.taxRate;
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
      const amountPaid = round2(splits[label].payments.reduce((sum, p) => sum + p.amount, 0));
      const unpaidBalance = round2(Math.max(calculationBreakdown.totalDue - amountPaid, 0));
      let state: BillingState = 'open';
      if (calculationBreakdown.totalDue === 0) state = 'open';
      else if (amountPaid === 0) state = unpaidBalance > 0 ? 'debt' : 'open';
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
  bill.state = splitStates.every((x) => x === 'paid') ? 'paid' : splitStates.some((x) => x === 'partially_paid' || x === 'debt') ? 'partially_paid' : 'open';
  bill.calculationBreakdown = mergeBreakdowns(bill.splits, bill.pricing);
  bill.receiptPayload = buildReceiptPayload(bill);
  bill.updatedAt = new Date().toISOString();
  return bill;
}

function buildReceiptPayload(bill: BillRecord, localeInput?: string): ReceiptPayload {
  const totalPaid = round2(SPLIT_LABELS.reduce((sum, label) => sum + bill.splits[label].amountPaid, 0));
  const balanceDue = round2(Math.max(bill.calculationBreakdown.totalDue - totalPaid, 0));
  const locale = normalizeLocale(localeInput);
  const resource = getLocaleResource(locale);
  const typography = getTypographyForLocale(locale);
  const receiptCss = `font-family: ${typography.printFontFamily}; direction: ${typography.direction}; unicode-bidi: plaintext;`;

  return {
    receiptId: createId('receipt'),
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
  const now = new Date().toISOString();
  const existing = await getBillByTableSessionId(tableSessionId);
  if (existing) throw new Error(`Bill already exists for table session ${tableSessionId}.`);
  const pricing = normalizePricing(pricingInput);

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
    branchId,
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
    branchId,
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

export async function recordSplitPayment(input: {
  tableSessionId: string;
  splitLabel: SplitLabel;
  amount: number;
  method: PaymentMethod;
  actorUserId: string;
  paidAt?: string;
  createDebtForUnpaidBalance?: boolean;
}): Promise<BillRecord> {
  const bill = await getBillByTableSessionId(input.tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  if (!SPLIT_LABELS.includes(input.splitLabel)) throw new Error('Invalid split label. Use A, B, or C.');
  if (input.amount <= 0) throw new Error('Payment amount must be greater than zero.');

  const split = bill.splits[input.splitLabel];
  const beforeSplit = structuredClone(split);
  const payment: BillPayment = {
    id: createId('pay'),
    branchId: bill.branchId,
    splitLabel: input.splitLabel,
    amount: round2(input.amount),
    method: input.method,
    paidAt: input.paidAt ?? new Date().toISOString(),
    receivedByUserId: input.actorUserId,
  };

  split.payments.push(payment);
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
  }

  await appendBillingAuditEntry({
    id: createId('audit'),
    branchId: bill.branchId,
    tableSessionId: bill.tableSessionId,
    splitLabel: input.splitLabel,
    action: 'split_payment_recorded',
    actorUserId: input.actorUserId,
    at: payment.paidAt,
    details: { paymentId: payment.id, amount: payment.amount, method: payment.method },
  });

  return saveBill(bill);
}

export async function settleDebt(input: {
  tableSessionId: string;
  splitLabel: SplitLabel;
  amount: number;
  actorUserId: string;
  method: PaymentMethod;
  paidAt?: string;
}): Promise<BillRecord> {
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
}
