export type BillingState = 'open' | 'partially_paid' | 'paid' | 'debt';
export type PaymentMethod = 'cash' | 'wave_money' | 'kbzpay';
export type SplitLabel = 'A' | 'B' | 'C';

export interface TableOrderItem {
  id: string;
  orderId: string;
  tableSessionId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineDiscount?: number;
  lineTax?: number;
}

export interface BillLineItem {
  id: string;
  orderItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  lineTax: number;
  lineTotal: number;
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
