import type { OrderRecord } from '../orders/repository';
import { getPosOperationalSettings, listPrepStations } from '../config/posSettings';
import type { Station } from '../kds/repository';
import { createConnection } from 'node:net';

export interface OrderPrintResult {
  printJobId: string;
  printerId: string;
  station: Station;
  printedAt: string;
  renderedText: string;
  copyCount: number;
}

function orderDestinationLine(order: OrderRecord): string {
  if (order.serviceMode === 'dine_in') return `Table: ${order.tableName ?? order.tableId ?? order.tableSessionId ?? 'Unassigned table'}`;
  return order.takeoutName?.trim() ? `Takeout: ${order.takeoutName.trim()}` : 'Takeout: Guest';
}

export class SimulatorOrderPrinterAdapter {
  readonly jobs: OrderPrintResult[] = [];

  async printOrder(order: OrderRecord, station: Station, automatic = false): Promise<OrderPrintResult | null> {
    const settings = getPosOperationalSettings();
    const printer = settings.printers[station];
    const items = order.items.filter((item) => (item.station ?? 'kitchen') === station);
    if (!printer?.enabled || (automatic && !printer.autoPrint) || !items.length) return null;
    const printedAt = new Date().toISOString();
    const renderedText = [
      `${station.toUpperCase()} ORDER SLIP`,
      `Station: ${settings.prepStations.find((row) => row.id === station)?.displayName ?? station}`,
      `Order: ${order.id}`,
      orderDestinationLine(order),
      ...(order.tableSessionId ? [`Table session: ${order.tableSessionId}`] : []),
      ...items.map((item) => `${item.quantity} x ${item.name}${item.note ? ` — ${item.note}` : ''}`),
    ].join('\n');
    if (printer.connectionType === 'network') {
      if (!printer.networkAddress) throw new Error(`Network address is required for ${printer.displayName}.`);
      await sendToNetworkPrinter(printer.networkAddress, printer.networkPort, renderedText, printer.copies);
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

function sendToNetworkPrinter(host: string, port: number, text: string, copies: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(5000);
    socket.once('connect', () => {
      const ticket = Buffer.from(`\x1b@${text}\n\n\n\x1dV\x00`, 'utf8');
      for (let copy = 0; copy < copies; copy += 1) socket.write(ticket);
      socket.end();
    });
    socket.once('timeout', () => socket.destroy(new Error(`Printer ${host}:${port} timed out.`)));
    socket.once('error', reject);
    socket.once('close', (hadError) => { if (!hadError) resolve(); });
  });
}

let orderPrinterAdapter = new SimulatorOrderPrinterAdapter();

export function getOrderPrinterAdapter(): SimulatorOrderPrinterAdapter {
  return orderPrinterAdapter;
}

export function resetOrderPrinterAdapter(): SimulatorOrderPrinterAdapter {
  orderPrinterAdapter = new SimulatorOrderPrinterAdapter();
  return orderPrinterAdapter;
}
