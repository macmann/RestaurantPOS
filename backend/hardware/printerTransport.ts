import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

function logPrinterEvent(event: string, details: Record<string, unknown>): void {
  console.info(`[printer] ${event}`, details);
}

const CUT_FEED_LINES = 5;
// A 9-point font is about 25 dots high on the 203-DPI print head used by
// standard 80-mm receipt printers. System.Drawing bitmaps default to 96 DPI,
// where the same point size is rasterized at only 12 pixels (roughly 50%).
// Specify the physical pixel height so the ESC/POS raster is not shrunk into
// the left half of the receipt.
export const NETWORK_RASTER_FONT_HEIGHT_DOTS = 25;

const MYANMAR_CHARACTER_PATTERN = /[\u1000-\u109f\uaa60-\uaa7f\ua9e0-\ua9ff]/u;
export const MYANMAR_PRINT_FONT_FAMILY = "'Noto Sans Myanmar', 'Myanmar Text', 'Padauk', 'Pyidaungsu', sans-serif";

export function containsMyanmarText(text: string): boolean {
  return MYANMAR_CHARACTER_PATTERN.test(text);
}

/**
 * Item and note text can be Myanmar even when the POS/receipt locale is English.
 * Always select a shaping-capable font for those jobs rather than relying on the
 * locale's (often Latin-only) font preference.
 */
export function printFontFamilyForText(text: string, requestedFontFamily = 'Arial'): string {
  return containsMyanmarText(text) ? MYANMAR_PRINT_FONT_FAMILY : requestedFontFamily;
}

/** Build an ESC/POS job with enough trailing paper to clear the cutter. */
export function buildNetworkPrinterTicket(text: string): Buffer {
  const trailingFeed = '\n'.repeat(CUT_FEED_LINES);
  return Buffer.from(`\x1b@${text}${trailingFeed}\x1dV\x00`, 'utf8');
}

/**
 * Raw ESC/POS text mode has no Myanmar code page and therefore cannot shape
 * sequences such as "ရွှေ". Render those jobs on Windows and send the resulting
 * monochrome pixels to the network printer instead.
 */
function buildWindowsRasterPrinterTicket(text: string, fontFamily: string): Promise<Buffer> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Myanmar text cannot be sent in raw ESC/POS text mode. Run the POS API on Windows (with Noto Sans Myanmar, Myanmar Text, Padauk, or Pyidaungsu installed), or configure the printer as a Windows installed printer.'));
  }

  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Drawing',
    '$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:POS_PRINT_TEXT))',
    '$requested = $env:POS_PRINT_FONT -split "," | ForEach-Object { $_.Trim(" ", "\'", [char]34) }',
    '$installed = New-Object Drawing.Text.InstalledFontCollection',
    '$available = @($installed.Families | ForEach-Object { $_.Name })',
    '$family = $requested | Where-Object { $available -contains $_ } | Select-Object -First 1',
    'if (-not $family) { throw "Install a Myanmar font (Noto Sans Myanmar, Myanmar Text, Padauk, or Pyidaungsu) on the POS computer." }',
    `$font = New-Object Drawing.Font($family, ${NETWORK_RASTER_FONT_HEIGHT_DOTS}, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)`,
    '$probe = New-Object Drawing.Bitmap(1, 1)',
    '$probeGraphics = [Drawing.Graphics]::FromImage($probe)',
    '$format = New-Object Drawing.StringFormat([Drawing.StringFormat]::GenericTypographic)',
    '$size = $probeGraphics.MeasureString($text, $font, 576, $format)',
    '$height = [Math]::Max(1, [Math]::Ceiling($size.Height) + 8)',
    '$probeGraphics.Dispose(); $probe.Dispose()',
    '$bitmap = New-Object Drawing.Bitmap(576, $height)',
    '$graphics = [Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.Clear([Drawing.Color]::White)',
    '$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit',
    '$graphics.DrawString($text, $font, [Drawing.Brushes]::Black, (New-Object Drawing.RectangleF(0, 0, 576, $height)), $format)',
    '$stride = 72; $bytes = New-Object byte[] ($stride * $height)',
    'for ($y = 0; $y -lt $height; $y++) { for ($x = 0; $x -lt 576; $x++) { $pixel = $bitmap.GetPixel($x, $y); if (($pixel.R + $pixel.G + $pixel.B) -lt 600) { $index = ($y * $stride) + [Math]::Floor($x / 8); $bytes[$index] = $bytes[$index] -bor (0x80 -shr ($x % 8)) } } }',
    '$header = [byte[]](0x1b,0x40,0x1d,0x76,0x30,0x00,0x48,0x00,($height -band 0xff),(($height -shr 8) -band 0xff))',
    '$footer = [byte[]](0x0a,0x0a,0x0a,0x0a,0x0a,0x1d,0x56,0x00)',
    '$output = New-Object byte[] ($header.Length + $bytes.Length + $footer.Length)',
    '[Array]::Copy($header, 0, $output, 0, $header.Length); [Array]::Copy($bytes, 0, $output, $header.Length, $bytes.Length); [Array]::Copy($footer, 0, $output, $header.Length + $bytes.Length, $footer.Length)',
    '$graphics.Dispose(); $bitmap.Dispose(); $format.Dispose(); $font.Dispose(); $installed.Dispose()',
    '[Console]::Out.Write([Convert]::ToBase64String($output))',
  ].join('; ');

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, POS_PRINT_FONT: fontFamily, POS_PRINT_TEXT: Buffer.from(text, 'utf8').toString('base64') },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = ''; let errorOutput = '';
    child.stdout.setEncoding('ascii'); child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { errorOutput += chunk; });
    child.once('error', (error) => reject(new Error(`Could not start Myanmar print rendering: ${error.message}`)));
    child.once('close', (code) => code === 0 ? resolve(Buffer.from(output.trim(), 'base64')) : reject(new Error(`Could not render Myanmar print job${errorOutput.trim() ? `: ${errorOutput.trim()}` : '.'}`)));
  });
}

export async function sendToNetworkPrinter(host: string, port: number, text: string, copies: number, fontFamily = 'Arial'): Promise<void> {
  const startedAt = Date.now();
  logPrinterEvent('network job starting', { host, port, copies, bytes: Buffer.byteLength(text, 'utf8') });
  const ticket = containsMyanmarText(text) ? await buildWindowsRasterPrinterTicket(text, printFontFamilyForText(text, fontFamily)) : buildNetworkPrinterTicket(text);
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
    '$requested = $env:POS_PRINT_FONT -split "," | ForEach-Object { $_.Trim(" ", "\'", [char]34) }',
    '$installed = New-Object Drawing.Text.InstalledFontCollection',
    '$available = @($installed.Families | ForEach-Object { $_.Name })',
    '$preferred = $requested | Where-Object { $available -contains $_ } | Select-Object -First 1',
    'if (-not $preferred) { throw "None of the configured print fonts are installed. Install Noto Sans Myanmar, Myanmar Text, Padauk, or Pyidaungsu." }',
    '$font = New-Object Drawing.Font($preferred, 9)',
    '$doc = New-Object Drawing.Printing.PrintDocument',
    '$doc.PrinterSettings.PrinterName = $env:POS_PRINTER_NAME',
    '$doc.PrinterSettings.Copies = [int16]$env:POS_PRINT_COPIES',
    // Let the receipt-printer driver enforce only its physical non-printable
    // area instead of adding application margins on every side.
    '$doc.DefaultPageSettings.Margins = New-Object Drawing.Printing.Margins(0, 0, 0, 0)',
    '$doc.add_PrintPage({ param($sender, $e); $format = New-Object Drawing.StringFormat; $format.FormatFlags = [Drawing.StringFormatFlags]::LineLimit; $e.Graphics.DrawString($text, $font, [Drawing.Brushes]::Black, $e.MarginBounds, $format); $e.HasMorePages = $false })',
    '$doc.Print()',
    '$doc.Dispose(); $font.Dispose(); $installed.Dispose()',
  ].join('; ');

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, POS_PRINTER_NAME: printerName, POS_PRINT_COPIES: String(copies), POS_PRINT_FONT: printFontFamilyForText(text, fontFamily), POS_PRINT_TEXT: Buffer.from(text, 'utf8').toString('base64') },
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
