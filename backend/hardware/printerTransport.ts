import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

function logPrinterEvent(event: string, details: Record<string, unknown>): void {
  console.info(`[printer] ${event}`, details);
}

const CUT_FEED_LINES = 5;

/** Build an ESC/POS job with enough trailing paper to clear the cutter. */
export function buildNetworkPrinterTicket(text: string): Buffer {
  const trailingFeed = '\n'.repeat(CUT_FEED_LINES);
  return Buffer.from(`\x1b@${text}${trailingFeed}\x1dV\x00`, 'utf8');
}

export function sendToNetworkPrinter(host: string, port: number, text: string, copies: number): Promise<void> {
  const startedAt = Date.now();
  logPrinterEvent('network job starting', { host, port, copies, bytes: Buffer.byteLength(text, 'utf8') });
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      console.error('[printer] network job failed', { host, port, copies, durationMs: Date.now() - startedAt, error: error.message });
      reject(error);
    };
    socket.setTimeout(5000);
    socket.once('connect', () => {
      const ticket = buildNetworkPrinterTicket(text);
      logPrinterEvent('network connection established', { host, port, copies, ticketBytes: ticket.length });
      for (let copy = 0; copy < copies; copy += 1) socket.write(ticket);
      socket.end();
    });
    socket.once('timeout', () => socket.destroy(new Error(`Printer ${host}:${port} timed out after 5000ms.`)));
    socket.once('error', fail);
    socket.once('close', (hadError) => {
      if (hadError || settled) return;
      settled = true;
      logPrinterEvent('network job sent', { host, port, copies, durationMs: Date.now() - startedAt });
      resolve();
    });
  });
}

/** Send Unicode text through the Windows print spooler and the printer's installed driver. */
export function sendToWindowsPrinter(printerName: string, text: string, copies: number, fontFamily = 'Arial'): Promise<void> {
  if (process.platform !== 'win32') {
    console.error('[printer] Windows job rejected', { printerName, copies, platform: process.platform, error: 'API host is not Windows' });
    return Promise.reject(new Error('Windows installed printers can only be used when the POS API is running on Windows.'));
  }

  const startedAt = Date.now();
  logPrinterEvent('Windows job starting', { printerName, copies, characters: text.length });

  // Draw with the Windows printer driver instead of piping text to Out-Printer. Generic
  // text drivers reinterpret UTF-8 bytes as a legacy code page, which produces mojibake.
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Drawing',
    '$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:POS_PRINT_TEXT))',
    '$preferred = ($env:POS_PRINT_FONT -split ",")[0].Trim(" ", "\'", [char]34)',
    '$font = New-Object Drawing.Font($preferred, 9)',
    '$doc = New-Object Drawing.Printing.PrintDocument',
    '$doc.PrinterSettings.PrinterName = $env:POS_PRINTER_NAME',
    '$doc.PrinterSettings.Copies = [int16]$env:POS_PRINT_COPIES',
    '$doc.DefaultPageSettings.Margins = New-Object Drawing.Printing.Margins(4, 4, 4, 4)',
    '$doc.add_PrintPage({ param($sender, $e); $format = New-Object Drawing.StringFormat; $format.FormatFlags = [Drawing.StringFormatFlags]::LineLimit; $e.Graphics.DrawString($text, $font, [Drawing.Brushes]::Black, $e.MarginBounds, $format); $e.HasMorePages = $false })',
    '$doc.Print()',
    '$doc.Dispose(); $font.Dispose()',
  ].join('; ');

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, POS_PRINTER_NAME: printerName, POS_PRINT_COPIES: String(copies), POS_PRINT_FONT: fontFamily, POS_PRINT_TEXT: Buffer.from(text, 'utf8').toString('base64') },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let errorOutput = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { errorOutput += chunk; });
    child.once('error', (error) => {
      console.error('[printer] Windows job failed to start', { printerName, copies, error: error.message });
      reject(new Error(`Could not start Windows printing: ${error.message}`));
    });
    child.once('close', (code) => {
      if (code === 0) {
        logPrinterEvent('Windows job sent', { printerName, copies, durationMs: Date.now() - startedAt });
        resolve();
        return;
      }
      const error = `Windows printer "${printerName}" rejected the job${errorOutput.trim() ? `: ${errorOutput.trim()}` : '.'}`;
      console.error('[printer] Windows job failed', { printerName, copies, durationMs: Date.now() - startedAt, exitCode: code, error });
      reject(new Error(error));
    });
  });
}
