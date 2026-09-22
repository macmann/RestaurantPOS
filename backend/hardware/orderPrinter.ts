import type { OrderRecord } from '../orders/repository';
import { getPosOperationalSettings, listPrepStations } from '../config/posSettings';
import type { Station } from '../kds/repository';
import { MYANMAR_PRINT_FONT_FAMILY, sendToNetworkPrinter, sendToWindowsPrinter } from './printerTransport';

// Unicode tickets are rasterized with a wider font than the printer's native
// text mode, so a 42-character rule wraps on common 80 mm paper.
const ORDER_SLIP_SEPARATOR = '='.repeat(32);

export interface OrderPrintResult {
  printJobId: string;
  printerId: string;
  station: Station;
  printedAt: string;
  renderedText: string;
  copyCount: number;
}

function orderDestinationLine(order: OrderRecord): string {
  if (order.serviceMode === 'dine_in') return `*** TABLE: ${order.tableName ?? order.tableId ?? 'UNASSIGNED'} ***`;
  return order.takeoutName?.trim() ? `Takeout: ${order.takeoutName.trim()}` : 'Takeout: Guest';
}

function ticketDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso));
}

export class SimulatorOrderPrinterAdapter {
  readonly jobs: OrderPrintResult[] = [];

  async printOrder(order: OrderRecord, station: Station, automatic = false): Promise<OrderPrintResult | null> {
    const settings = getPosOperationalSettings();
    const printerKey = settings.printerAssignments[station];
    const printer = settings.printers[printerKey];
    const items = order.items.filter((item) => (item.station ?? 'kitchen') === station);
    if (!printer?.enabled || (automatic && !printer.autoPrint) || !items.length) return null;
    const printedAt = new Date().toISOString();
    const renderedText = [
      `${station.toUpperCase()} ORDER SLIP`,
      `Station: ${settings.prepStations.find((row) => row.id === station)?.displayName ?? station}`,
      `Date & time: ${ticketDateTime(printedAt)}`,
      ORDER_SLIP_SEPARATOR,
      orderDestinationLine(order),
      ORDER_SLIP_SEPARATOR,
      ...items.map((item) => `${item.quantity} x ${item.name}${item.note ? ` — ${item.note}` : ''}`),
    ].join('\n');
    if (printer.connectionType === 'network') {
      if (!printer.networkAddress) throw new Error(`Network address is required for ${printer.displayName}.`);
      await sendToNetworkPrinter(printer.networkAddress, printer.networkPort, renderedText, printer.copies, MYANMAR_PRINT_FONT_FAMILY);
    } else if (printer.connectionType === 'windows') {
      if (!printer.windowsPrinterName) throw new Error(`Windows printer name is required for ${printer.displayName}.`);
      await sendToWindowsPrinter(printer.windowsPrinterName, renderedText, printer.copies, MYANMAR_PRINT_FONT_FAMILY);
    }
    const result = { printJobId: `order_print_${this.jobs.length + 1}`, printerId: printer.printerId, station, printedAt, renderedText, copyCount: printer.copies };
    this.jobs.push(structuredClone(result));
    return structuredClone(result);
  }

  async printOrderForConfiguredStations(order: OrderRecord, automatic = false): Promise<OrderPrintResult[]> {
    const results = await Promise.all(listPrepStations().map((station) => this.printOrder(order, station.id, automatic)));
    return results.filter((result): result is OrderPrintResult => Boolean(result));
  }
}

let orderPrinterAdapter = new SimulatorOrderPrinterAdapter();

export function getOrderPrinterAdapter(): SimulatorOrderPrinterAdapter {
  return orderPrinterAdapter;
}

export function resetOrderPrinterAdapter(): SimulatorOrderPrinterAdapter {
  orderPrinterAdapter = new SimulatorOrderPrinterAdapter();
  return orderPrinterAdapter;
}
