import {
  appendBillingAuditEntry,
  appendDebtLedgerEntry,
  getBillByTableSessionId,
  saveBill,
  type BillLineItem,
  type BillPayment,
  type BillRecord,
  type BillingState,
  type PaymentMethod,
  type SplitLabel,
  type TableOrderItem,
} from './repository';

const SPLIT_LABELS: SplitLabel[] = ['A', 'B', 'C'];

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeLineTotal(item: Pick<BillLineItem, 'quantity' | 'unitPrice' | 'lineDiscount' | 'lineTax'>): number {
  return round2(item.quantity * item.unitPrice - item.lineDiscount + item.lineTax);
}

function recalcSplit(split: BillRecord['splits'][SplitLabel]): BillRecord['splits'][SplitLabel] {
  const subtotal = round2(split.lineItems.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0));
  const discountTotal = round2(split.lineItems.reduce((sum, it) => sum + it.lineDiscount, 0));
  const taxTotal = round2(split.lineItems.reduce((sum, it) => sum + it.lineTax, 0));
  const totalDue = round2(split.lineItems.reduce((sum, it) => sum + it.lineTotal, 0));
  const amountPaid = round2(split.payments.reduce((sum, p) => sum + p.amount, 0));
  const unpaidBalance = round2(Math.max(totalDue - amountPaid, 0));

  let state: BillingState = 'open';
  if (totalDue === 0) state = 'open';
  else if (amountPaid === 0) state = unpaidBalance > 0 ? 'debt' : 'open';
  else if (unpaidBalance > 0) state = 'partially_paid';
  else state = 'paid';

  return { ...split, subtotal, discountTotal, taxTotal, totalDue, amountPaid, unpaidBalance, state };
}

export async function generateBillFromSessionItems(
  tableSessionId: string,
  itemsBySplit: Partial<Record<SplitLabel, TableOrderItem[]>>,
  actorUserId: string,
): Promise<BillRecord> {
  const now = new Date().toISOString();
  const existing = await getBillByTableSessionId(tableSessionId);
  if (existing) throw new Error(`Bill already exists for table session ${tableSessionId}.`);

  const splits = Object.fromEntries(
    SPLIT_LABELS.map((label) => {
      const sourceItems = itemsBySplit[label] ?? [];
      const lineItems: BillLineItem[] = sourceItems.map((it) => {
        const lineDiscount = round2(it.lineDiscount ?? 0);
        const lineTax = round2(it.lineTax ?? 0);
        return {
          id: createId('bill_item'),
          orderItemId: it.id,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          lineDiscount,
          lineTax,
          lineTotal: computeLineTotal({ quantity: it.quantity, unitPrice: it.unitPrice, lineDiscount, lineTax }),
        };
      });

      const split = recalcSplit({
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
      });
      return [label, split];
    }),
  ) as BillRecord['splits'];

  const next: BillRecord = {
    id: createId('bill'),
    tableSessionId,
    splits,
    state: 'open',
    createdAt: now,
    updatedAt: now,
  };

  await appendBillingAuditEntry({
    id: createId('audit'),
    tableSessionId,
    splitLabel: 'A',
    action: 'bill_generated',
    actorUserId,
    at: now,
    details: { splitItemCounts: Object.fromEntries(SPLIT_LABELS.map((x) => [x, splits[x].lineItems.length])) },
  });

  return saveBill(next);
}

export async function recordSplitPayment(input: {
  tableSessionId: string;
  splitLabel: SplitLabel;
  amount: number;
  method: PaymentMethod;
  actorUserId: string;
  paidAt?: string;
}): Promise<BillRecord> {
  const bill = await getBillByTableSessionId(input.tableSessionId);
  if (!bill) throw new Error('Bill not found for table session.');
  if (!SPLIT_LABELS.includes(input.splitLabel)) throw new Error('Invalid split label. Use A, B, or C.');
  if (input.amount <= 0) throw new Error('Payment amount must be greater than zero.');

  const split = bill.splits[input.splitLabel];
  const payment: BillPayment = {
    id: createId('pay'),
    splitLabel: input.splitLabel,
    amount: round2(input.amount),
    method: input.method,
    paidAt: input.paidAt ?? new Date().toISOString(),
    receivedByUserId: input.actorUserId,
  };

  split.payments.push(payment);
  bill.splits[input.splitLabel] = recalcSplit(split);

  if (bill.splits[input.splitLabel].unpaidBalance > 0) {
    await appendDebtLedgerEntry({
      id: createId('debt'),
      tableSessionId: bill.tableSessionId,
      splitLabel: input.splitLabel,
      amount: bill.splits[input.splitLabel].unpaidBalance,
      reason: 'unpaid_balance',
      action: 'debt_created',
      actorUserId: input.actorUserId,
      at: payment.paidAt,
      metadata: { paymentId: payment.id, amountPaid: payment.amount },
    });
  }

  await appendBillingAuditEntry({
    id: createId('audit'),
    tableSessionId: bill.tableSessionId,
    splitLabel: input.splitLabel,
    action: 'split_payment_recorded',
    actorUserId: input.actorUserId,
    at: payment.paidAt,
    details: { paymentId: payment.id, amount: payment.amount, method: payment.method },
  });

  const splitStates = SPLIT_LABELS.map((label) => bill.splits[label].state);
  bill.state = splitStates.every((x) => x === 'paid') ? 'paid' : splitStates.some((x) => x === 'partially_paid' || x === 'debt') ? 'partially_paid' : 'open';
  bill.updatedAt = new Date().toISOString();

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
  const bill = await recordSplitPayment(input);
  const split = bill.splits[input.splitLabel];
  const now = input.paidAt ?? new Date().toISOString();

  await appendDebtLedgerEntry({
    id: createId('debt'),
    tableSessionId: input.tableSessionId,
    splitLabel: input.splitLabel,
    amount: round2(input.amount),
    reason: 'settlement_payment',
    action: split.unpaidBalance > 0 ? 'debt_settled_partial' : 'debt_settled_full',
    actorUserId: input.actorUserId,
    at: now,
    metadata: { resultingUnpaidBalance: split.unpaidBalance },
  });

  await appendBillingAuditEntry({
    id: createId('audit'),
    tableSessionId: input.tableSessionId,
    splitLabel: input.splitLabel,
    action: 'debt_settlement_recorded',
    actorUserId: input.actorUserId,
    at: now,
    details: { amount: input.amount, method: input.method, resultingUnpaidBalance: split.unpaidBalance },
  });

  return bill;
}
