import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

export function sendToNetworkPrinter(host: string, port: number, text: string, copies: number): Promise<void> {
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

/** Send Unicode text through the Windows print spooler and the printer's installed driver. */
export function sendToWindowsPrinter(printerName: string, text: string, copies: number): Promise<void> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Windows installed printers can only be used when the POS API is running on Windows.'));
  }

  const script = [
    '$ErrorActionPreference = "Stop"',
    '$text = [Console]::In.ReadToEnd()',
    '1..([int]$env:POS_PRINT_COPIES) | ForEach-Object { $text | Out-Printer -Name $env:POS_PRINTER_NAME }',
  ].join('; ');

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, POS_PRINTER_NAME: printerName, POS_PRINT_COPIES: String(copies) },
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let errorOutput = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { errorOutput += chunk; });
    child.once('error', (error) => reject(new Error(`Could not start Windows printing: ${error.message}`)));
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`Windows printer "${printerName}" rejected the job${errorOutput.trim() ? `: ${errorOutput.trim()}` : '.'}`)));
    child.stdin.end(text, 'utf8');
  });
}
