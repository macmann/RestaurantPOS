import type { OrderRecord } from '../orders/repository';
import { getPosOperationalSettings } from '../config/posSettings';

export interface OrderPrintResult {
  printJobId: string;
  printerId: string;
  station: 'kitchen' | 'bar';
  printedAt: string;
  renderedText: string;
}

export class SimulatorOrderPrinterAdapter {
  readonly jobs: OrderPrintResult[] = [];

  async printOrder(order: OrderRecord, station: 'kitchen' | 'bar'): Promise<OrderPrintResult | null> {
    const settings = getPosOperationalSettings();
    const printer = settings.printers[station];
    const items = order.items.filter((item) => (item.station ?? 'kitchen') === station);
    if (!printer.enabled || !items.length) return null;
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
}

let orderPrinterAdapter = new SimulatorOrderPrinterAdapter();

export function getOrderPrinterAdapter(): SimulatorOrderPrinterAdapter {
  return orderPrinterAdapter;
}

export function resetOrderPrinterAdapter(): SimulatorOrderPrinterAdapter {
  orderPrinterAdapter = new SimulatorOrderPrinterAdapter();
  return orderPrinterAdapter;
}
