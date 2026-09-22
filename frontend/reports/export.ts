export interface ReportExportColumn {
  key: string;
  label: string;
  type: 'string' | 'number' | 'currency' | 'date';
}

export interface ReportExportMetadata {
  columns: ReportExportColumn[];
  rows: Array<Record<string, unknown>>;
  print: { title: string; subtitle: string; orientation: 'portrait' | 'landscape'; locale: string; fontFamily: string; unicodeSample: string };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** UTF-8 BOM keeps Myanmar and other Unicode text intact in spreadsheet programs. */
export function reportCsv(metadata: Pick<ReportExportMetadata, 'columns' | 'rows'>): string {
  const lines = [metadata.columns.map((column) => csvCell(column.label)).join(',')];
  for (const row of metadata.rows) lines.push(metadata.columns.map((column) => csvCell(row[column.key])).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}

function html(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function reportPrintDocument(metadata: ReportExportMetadata, timezone: string): string {
  const generated = new Intl.DateTimeFormat(metadata.print.locale, { dateStyle: 'medium', timeStyle: 'long', timeZone: timezone }).format(new Date());
  return `<!doctype html><html lang="${html(metadata.print.locale)}"><head><meta charset="utf-8"><title>${html(metadata.print.title)}</title><style>@page{size:${metadata.print.orientation}}body{font-family:${html(metadata.print.fontFamily)};color:#111;margin:24px}h1{margin-bottom:4px}.meta{color:#555}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>${html(metadata.print.title)}</h1><p>${html(metadata.print.subtitle)}</p><p class="meta">Generated ${html(generated)} · Timezone: ${html(timezone)}</p><p aria-hidden="true">${html(metadata.print.unicodeSample)}</p><table><thead><tr>${metadata.columns.map((column) => `<th>${html(column.label)}</th>`).join('')}</tr></thead><tbody>${metadata.rows.map((row) => `<tr>${metadata.columns.map((column) => `<td>${html(row[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}

export function downloadReportCsv(metadata: Pick<ReportExportMetadata, 'columns' | 'rows'>, filename: string): void {
  const url = URL.createObjectURL(new Blob([reportCsv(metadata)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

export function printReport(metadata: ReportExportMetadata, timezone: string): boolean {
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) return false;
  popup.document.open(); popup.document.write(reportPrintDocument(metadata, timezone)); popup.document.close();
  popup.addEventListener('load', () => { popup.focus(); popup.print(); }, { once: true });
  return true;
}
