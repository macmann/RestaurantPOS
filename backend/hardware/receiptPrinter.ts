import type { ReceiptPayload, SplitLabel } from '../billing/repository';
import { getPosOperationalSettings } from '../config/posSettings';
import { sendToNetworkPrinter, sendToWindowsPrinter } from './printerTransport';

export interface ReceiptPrintRequest {
  payload: ReceiptPayload;
  splitLabel?: SplitLabel;
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

const RECEIPT_WIDTH = 42;

function receiptRow(label: string, value: string): string {
  const available = Math.max(1, RECEIPT_WIDTH - value.length - 1);
  return `${label.slice(0, available).padEnd(available)} ${value}`;
}

function renderSplit(payload: ReceiptPayload, split: ReceiptPayload['splits'][number], showSplitLabel: boolean): string[] {
  const lines = showSplitLabel ? [`${payload.labels.split} ${split.label as SplitLabel}`, '-'.repeat(RECEIPT_WIDTH)] : [];
  for (const item of split.lines) {
    lines.push(`${item.quantity} x ${item.name}`);
    lines.push(receiptRow(`  @ ${money(item.unitPrice)}`, money(item.lineTotal)));
  }
  lines.push('-'.repeat(RECEIPT_WIDTH));
  lines.push(receiptRow(payload.labels.subtotal, money(split.calculationBreakdown.subtotal)));
  lines.push(receiptRow(payload.labels.discount, money(split.calculationBreakdown.discounts.total)));
  lines.push(receiptRow(payload.labels.tax, money(split.calculationBreakdown.taxTotal)));
  lines.push(receiptRow(payload.labels.total_due, money(split.calculationBreakdown.totalDue)));
  for (const payment of split.payments) {
    const label = payload.paymentLabels[payment.method] ?? payment.method;
    lines.push(receiptRow(label, money(payment.amount)));
  }
  return lines;
}

export function renderReceiptPayload(payload: ReceiptPayload, requestedSplit?: SplitLabel): string {
  const activeSplits = payload.splits.filter((split) => split.lines.length > 0 || split.calculationBreakdown.totalDue > 0);
  const splits = requestedSplit ? activeSplits.filter((split) => split.label === requestedSplit) : activeSplits;
  if (requestedSplit && !splits.length) throw new Error(`Split ${requestedSplit} has no bill items to print.`);
  if (!requestedSplit && activeSplits.length > 1) throw new Error('Choose a split before printing a split bill.');
  const splitTotalPaid = splits.flatMap((split) => split.payments).reduce((sum, payment) => sum + payment.amount, 0);
  const splitTotalDue = splits.reduce((sum, split) => sum + split.calculationBreakdown.totalDue, 0);
  return [
    payload.restaurant.restaurantName,
    payload.restaurant.address,
    payload.restaurant.contact,
    payload.restaurant.taxId ? `Tax ID: ${payload.restaurant.taxId}` : '',
    payload.labels.receipt,
    `Date & time: ${new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(payload.generatedAt))}`,
    '='.repeat(RECEIPT_WIDTH),
    ...(payload.tableName ? [`*** TABLE: ${payload.tableName} ***`, '='.repeat(RECEIPT_WIDTH)] : []),
    ...splits.flatMap((split) => renderSplit(payload, split, activeSplits.length > 1)),
    '='.repeat(RECEIPT_WIDTH),
    receiptRow(payload.labels.total_paid, money(splitTotalPaid)),
    receiptRow(payload.labels.balance_due, money(Math.max(splitTotalDue - splitTotalPaid, 0))),
    payload.restaurant.receiptFooter ?? '',
  ].filter(Boolean).join('\n');
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
      renderedText: renderReceiptPayload(request.payload, request.splitLabel),
    };
    this.jobs.push(structuredClone(result));
    return structuredClone(result);
  }
}

export class ConfiguredReceiptPrinterAdapter extends SimulatorReceiptPrinterAdapter {
  override async printReceipt(request: ReceiptPrintRequest): Promise<ReceiptPrintResult> {
    const result = await super.printReceipt(request);
    const printer = Object.values(getPosOperationalSettings().printers).find((candidate) => candidate.printerId === result.printerId);
    if (!printer) {
      console.error('[printer] receipt job rejected', { printJobId: result.printJobId, printerId: result.printerId, error: 'Printer ID is not configured' });
      throw new Error(`Receipt printer "${result.printerId}" is not configured.`);
    }
    console.info('[printer] receipt job prepared', {
      printJobId: result.printJobId,
      printerId: result.printerId,
      displayName: printer.displayName,
      connectionType: printer.connectionType,
      copies: result.copyCount,
      locale: result.locale,
    });
    if (printer?.connectionType === 'network') {
      if (!printer.networkAddress) throw new Error(`Network address is required for ${printer.displayName}.`);
      await sendToNetworkPrinter(printer.networkAddress, printer.networkPort, result.renderedText, result.copyCount, result.fontFamily);
    } else if (printer?.connectionType === 'windows') {
      if (!printer.windowsPrinterName) throw new Error(`Windows printer name is required for ${printer.displayName}.`);
      await sendToWindowsPrinter(printer.windowsPrinterName, result.renderedText, result.copyCount, result.fontFamily);
    } else {
      console.warn('[printer] simulator receipt completed without physical output', { printJobId: result.printJobId, printerId: result.printerId });
    }
    console.info('[printer] receipt job completed', { printJobId: result.printJobId, printerId: result.printerId, connectionType: printer.connectionType, copies: result.copyCount });
    return result;
  }
}

let receiptPrinterAdapter: ReceiptPrinterAdapter = new ConfiguredReceiptPrinterAdapter();

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
