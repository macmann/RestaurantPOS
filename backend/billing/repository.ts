export type BillingState = 'open' | 'partially_paid' | 'paid' | 'debt' | 'void';
export type PaymentMethod = 'cash' | 'wave_money' | 'kbzpay';
export type SplitLabel = 'A' | 'B' | 'C';
export type TaxMode = 'taxable' | 'tax_exempt';
export type ReceiptLabelKey = 'receipt' | 'table_session' | 'total_paid' | 'balance_due' | 'split' | 'subtotal' | 'discount' | 'tax' | 'total_due';
export type BillPromotionType = 'fixed_amount' | 'percentage';

export interface TableOrderItem {
  id: string;
  orderId: string;
  tableSessionId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  /** Explicit item-level markdown entered by staff before automatic promotions. */
  itemDiscount?: number;
  /** Automatic bundle/combo adjustment, applied after item-level discounts. */
  comboDiscount?: number;
  /** Automatic time-window adjustment, applied after combo discounts. */
  happyHourDiscount?: number;
  /** Legacy aggregate item adjustment. Treated as an item-level discount when itemDiscount is absent. */
  lineDiscount?: number;
  /** Legacy item tax. Ignored when bill-level tax configuration is supplied. */
  lineTax?: number;
}

export interface BillPromotion {
  id: string;
  name: string;
  type: BillPromotionType;
  value: number;
  maxDiscount?: number;
}

export interface BillPricingOptions {
  taxMode: TaxMode;
  taxRate: number;
  billPromotions?: BillPromotion[];
}

export interface DiscountBreakdown {
  itemLevel: number;
  combo: number;
  happyHour: number;
  billLevel: number;
  total: number;
}

export interface BillPromotionApplication {
  promotionId: string;
  name: string;
  type: BillPromotionType;
  value: number;
  baseAmount: number;
  amount: number;
  cappedBySubtotal: boolean;
  maxDiscountApplied?: number;
}

export interface BillLineCalculationBreakdown {
  lineItemId: string;
  orderItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  gross: number;
  discounts: Pick<DiscountBreakdown, 'itemLevel' | 'combo' | 'happyHour'>;
  netBeforeBillDiscount: number;
  tax: number;
  lineTotal: number;
}

export interface BillCalculationBreakdown {
  subtotal: number;
  discounts: DiscountBreakdown;
  taxableSubtotal: number;
  taxMode: TaxMode;
  taxRate: number;
  taxTotal: number;
  totalDue: number;
  roundingStrategy: 'round-half-up-to-cent-at-each-monetary-step';
  appliedPromotions: BillPromotionApplication[];
  lines: BillLineCalculationBreakdown[];
}

export interface BillLineItem {
  id: string;
  orderItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  itemDiscount: number;
  comboDiscount: number;
  happyHourDiscount: number;
  lineDiscount: number;
  lineTax: number;
  lineTotal: number;
  calculation: BillLineCalculationBreakdown;
}

export interface BillPayment {
  id: string;
  splitLabel: SplitLabel;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  receivedByUserId: string;
}

export interface BillSplit {
  label: SplitLabel;
  lineItems: BillLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  totalDue: number;
  amountPaid: number;
  unpaidBalance: number;
  state: BillingState;
  payments: BillPayment[];
  calculationBreakdown: BillCalculationBreakdown;
}

export interface ReceiptPayload {
  receiptId: string;
  locale: string;
  direction: 'ltr';
  fontFamily: string;
  printFontFamily: string;
  unicodeSample: string;
  labels: Record<ReceiptLabelKey, string>;
  paymentLabels: Record<PaymentMethod, string>;
  billStatusLabels: Record<BillingState, string>;
  receiptCss: string;
  billId: string;
  tableSessionId: string;
  generatedAt: string;
  splits: Array<{
    label: SplitLabel;
    lines: BillLineCalculationBreakdown[];
    payments: BillPayment[];
    calculationBreakdown: BillCalculationBreakdown;
  }>;
  calculationBreakdown: BillCalculationBreakdown;
  totalPaid: number;
  balanceDue: number;
}

export interface DebtLedgerEntry {
  id: string;
  tableSessionId: string;
  splitLabel: SplitLabel;
  amount: number;
  reason: 'unpaid_balance' | 'settlement_payment' | 'adjustment';
  action: 'debt_created' | 'debt_settled_partial' | 'debt_settled_full' | 'debt_adjusted';
  actorUserId: string;
  at: string;
  metadata?: Record<string, unknown>;
}

export interface BillingAuditEntry {
  id: string;
  tableSessionId: string;
  splitLabel: SplitLabel;
  action: string;
  actorUserId: string;
  at: string;
  details: Record<string, unknown>;
}

export interface BillRecord {
  id: string;
  tableSessionId: string;
  splits: Record<SplitLabel, BillSplit>;
  state: BillingState;
  pricing: BillPricingOptions;
  calculationBreakdown: BillCalculationBreakdown;
  receiptPayload?: ReceiptPayload;
  createdAt: string;
  updatedAt: string;
}

const billsBySession = new Map<string, BillRecord>();
const debtLedgerEntries: DebtLedgerEntry[] = [];
const auditEntries: BillingAuditEntry[] = [];

export async function saveBill(bill: BillRecord): Promise<BillRecord> {
  billsBySession.set(bill.tableSessionId, structuredClone(bill));
  return structuredClone(bill);
}

export async function listBills(): Promise<BillRecord[]> {
  return [...billsBySession.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((bill) => structuredClone(bill));
}

export async function getBillByTableSessionId(tableSessionId: string): Promise<BillRecord | null> {
  const found = billsBySession.get(tableSessionId);
  return found ? structuredClone(found) : null;
}

export async function appendDebtLedgerEntry(entry: DebtLedgerEntry): Promise<DebtLedgerEntry> {
  debtLedgerEntries.push(structuredClone(entry));
  return structuredClone(entry);
}

export async function listDebtLedgerByTableSessionId(tableSessionId: string): Promise<DebtLedgerEntry[]> {
  return debtLedgerEntries.filter((x) => x.tableSessionId === tableSessionId).map((x) => structuredClone(x));
}

export async function appendBillingAuditEntry(entry: BillingAuditEntry): Promise<BillingAuditEntry> {
  auditEntries.push(structuredClone(entry));
  return structuredClone(entry);
}

export async function listBillingAuditByTableSessionId(tableSessionId: string): Promise<BillingAuditEntry[]> {
  return auditEntries.filter((x) => x.tableSessionId === tableSessionId).map((x) => structuredClone(x));
}
