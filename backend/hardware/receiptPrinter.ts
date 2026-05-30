import type { ReceiptPayload, SplitLabel } from '../billing/repository';

export interface ReceiptPrintRequest {
  payload: ReceiptPayload;
  copies?: number;
  printerId?: string;
}

export interface ReceiptPrintResult {
  printJobId: string;
  printerId: string;
  printedAt: string;
  locale: string;
  fontFamily: string;
  copyCount: number;
  renderedText: string;
}

export interface ReceiptPrinterAdapter {
  readonly id: string;
  printReceipt(request: ReceiptPrintRequest): Promise<ReceiptPrintResult>;
}

function money(value: number): string {
  return value.toFixed(2);
}

function renderSplit(payload: ReceiptPayload, split: ReceiptPayload['splits'][number]): string[] {
  const lines = [`${payload.labels.split} ${split.label as SplitLabel}`];
  for (const item of split.lines) {
    lines.push(`${item.quantity} x ${item.name} @ ${money(item.unitPrice)} = ${money(item.lineTotal)}`);
  }
  lines.push(`${payload.labels.subtotal}: ${money(split.calculationBreakdown.subtotal)}`);
  lines.push(`${payload.labels.discount}: ${money(split.calculationBreakdown.discounts.total)}`);
  lines.push(`${payload.labels.tax}: ${money(split.calculationBreakdown.taxTotal)}`);
  lines.push(`${payload.labels.total_due}: ${money(split.calculationBreakdown.totalDue)}`);
  for (const payment of split.payments) {
    const label = payload.paymentLabels[payment.method] ?? payment.method;
    lines.push(`${label}: ${money(payment.amount)}`);
  }
  return lines;
}

export function renderReceiptPayload(payload: ReceiptPayload): string {
  return [
    `${payload.labels.receipt} ${payload.receiptId}`,
    `${payload.labels.table_session}: ${payload.tableSessionId}`,
    `Locale: ${payload.locale}`,
    `Font: ${payload.printFontFamily}`,
    payload.unicodeSample,
    ...payload.splits.flatMap((split) => renderSplit(payload, split)),
    `${payload.labels.total_paid}: ${money(payload.totalPaid)}`,
    `${payload.labels.balance_due}: ${money(payload.balanceDue)}`,
  ].join('\n');
}

export class SimulatorReceiptPrinterAdapter implements ReceiptPrinterAdapter {
  readonly id = 'simulator-receipt-printer';
  readonly jobs: ReceiptPrintResult[] = [];

  async printReceipt(request: ReceiptPrintRequest): Promise<ReceiptPrintResult> {
    const printedAt = new Date().toISOString();
    const result: ReceiptPrintResult = {
      printJobId: `sim_print_${this.jobs.length + 1}`,
      printerId: request.printerId ?? this.id,
      printedAt,
      locale: request.payload.locale,
      fontFamily: request.payload.printFontFamily,
      copyCount: request.copies ?? 1,
      renderedText: renderReceiptPayload(request.payload),
    };
    this.jobs.push(structuredClone(result));
    return structuredClone(result);
  }
}

let receiptPrinterAdapter: ReceiptPrinterAdapter = new SimulatorReceiptPrinterAdapter();

export function getReceiptPrinterAdapter(): ReceiptPrinterAdapter {
  return receiptPrinterAdapter;
}

export function setReceiptPrinterAdapter(adapter: ReceiptPrinterAdapter): void {
  receiptPrinterAdapter = adapter;
}

export function resetReceiptPrinterAdapter(): SimulatorReceiptPrinterAdapter {
  const adapter = new SimulatorReceiptPrinterAdapter();
  receiptPrinterAdapter = adapter;
  return adapter;
}
