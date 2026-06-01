import type { OrderRecord } from '../orders/repository';
import { getPosOperationalSettings, listPrepStations } from '../config/posSettings';
import type { Station } from '../kds/repository';

export interface OrderPrintResult {
  printJobId: string;
  printerId: string;
  station: Station;
  printedAt: string;
  renderedText: string;
}

export class SimulatorOrderPrinterAdapter {
  readonly jobs: OrderPrintResult[] = [];

  async printOrder(order: OrderRecord, station: Station): Promise<OrderPrintResult | null> {
    const settings = getPosOperationalSettings();
    const printer = settings.printers[station];
    const items = order.items.filter((item) => (item.station ?? 'kitchen') === station);
    if (!printer?.enabled || !items.length) return null;
    const printedAt = new Date().toISOString();
    const renderedText = [
      `${station.toUpperCase()} ORDER ${order.id}`,
      order.tableSessionId ? `Table session: ${order.tableSessionId}` : `Takeout: ${order.takeoutName ?? 'Guest'}`,
      ...items.map((item) => `${item.quantity} x ${item.name}${item.note ? ` — ${item.note}` : ''}`),
    ].join('\n');
    const result = { printJobId: `order_print_${this.jobs.length + 1}`, printerId: printer.printerId, station, printedAt, renderedText };
    this.jobs.push(structuredClone(result));
    return structuredClone(result);
  }

  async printOrderForConfiguredStations(order: OrderRecord): Promise<OrderPrintResult[]> {
    const results = await Promise.all(listPrepStations().map((station) => this.printOrder(order, station.id)));
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
