export interface BarcodeScanEvent {
  scannerId: string;
  symbology: 'ean13' | 'code128' | 'qr' | 'unknown';
  value: string;
  scannedAt: string;
}

export interface BarcodeScannerAdapter {
  readonly id: string;
  read(): Promise<BarcodeScanEvent | null>;
}

export class SimulatorBarcodeScannerAdapter implements BarcodeScannerAdapter {
  readonly id = 'simulator-barcode-scanner';
  private queue: BarcodeScanEvent[] = [];

  enqueue(value: string, symbology: BarcodeScanEvent['symbology'] = 'code128'): BarcodeScanEvent {
    const event: BarcodeScanEvent = { scannerId: this.id, symbology, value, scannedAt: new Date().toISOString() };
    this.queue.push(event);
    return event;
  }

  async read(): Promise<BarcodeScanEvent | null> {
    return this.queue.shift() ?? null;
  }
}

let barcodeScannerAdapter: BarcodeScannerAdapter = new SimulatorBarcodeScannerAdapter();

export function getBarcodeScannerAdapter(): BarcodeScannerAdapter {
  return barcodeScannerAdapter;
}

export function setBarcodeScannerAdapter(adapter: BarcodeScannerAdapter): void {
  barcodeScannerAdapter = adapter;
}

export function resetBarcodeScannerAdapter(): SimulatorBarcodeScannerAdapter {
  const adapter = new SimulatorBarcodeScannerAdapter();
  barcodeScannerAdapter = adapter;
  return adapter;
}
