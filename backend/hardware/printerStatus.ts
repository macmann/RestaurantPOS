import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { getPosOperationalSettings, type PrinterDeviceConfig } from '../config/posSettings';

export type PrinterConnectionStatus = 'online' | 'offline' | 'disabled' | 'simulator' | 'not_configured';

export interface PrinterStatus {
  printerKey: string;
  printerId: string;
  status: PrinterConnectionStatus;
  connection: string;
  checkedAt: string;
  detail: string;
}

function probeNetworkPrinter(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function probeWindowsPrinter(printerName: string): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  const escapedName = printerName.replace(/'/g, "''");
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$printer = Get-Printer -Name '${escapedName}' -ErrorAction SilentlyContinue; if ($printer -and $printer.PrinterStatus -notin @('Offline','Error')) { exit 0 } else { exit 1 }`], { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

async function statusFor(printerKey: string, printer: PrinterDeviceConfig, checkedAt: string): Promise<PrinterStatus> {
  const base = { printerKey, printerId: printer.printerId, checkedAt };
  if (!printer.enabled) return { ...base, status: 'disabled', connection: 'Disabled', detail: 'Disabled in printer settings' };
  if (printer.connectionType === 'simulator') return { ...base, status: 'simulator', connection: 'Simulator', detail: 'Test output only — no physical printer' };

  if (printer.connectionType === 'network') {
    if (!printer.networkAddress) return { ...base, status: 'not_configured', connection: 'Network', detail: 'IP address or hostname is not configured' };
    const connection = `${printer.networkAddress}:${printer.networkPort}`;
    const reachable = await probeNetworkPrinter(printer.networkAddress, printer.networkPort);
    return { ...base, status: reachable ? 'online' : 'offline', connection, detail: reachable ? 'TCP connection successful' : 'Printer did not accept a TCP connection' };
  }

  if (!printer.windowsPrinterName) return { ...base, status: 'not_configured', connection: 'Windows', detail: 'Windows printer name is not configured' };
  const reachable = await probeWindowsPrinter(printer.windowsPrinterName);
  return {
    ...base,
    status: reachable ? 'online' : 'offline',
    connection: printer.windowsPrinterName,
    detail: reachable ? 'Windows print queue is available' : process.platform === 'win32' ? 'Windows print queue is unavailable' : 'Windows printer is configured on a non-Windows API host',
  };
}

/** Return live connection results for every configured printer device. */
export async function getPrinterStatuses(): Promise<Record<string, PrinterStatus>> {
  const printers = getPosOperationalSettings().printers;
  const checkedAt = new Date().toISOString();
  const entries = await Promise.all(Object.entries(printers).map(async ([key, printer]) => [key, await statusFor(key, printer, checkedAt)] as const));
  return Object.fromEntries(entries);
}
