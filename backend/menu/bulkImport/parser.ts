import { inflateRawSync } from 'node:zlib';

export const BULK_UPLOAD_SHEET = 'Bulk Upload';
export const BULK_UPLOAD_COLUMNS = ['Name', 'Category', 'Station', 'Price'] as const;
export const MAX_BULK_UPLOAD_ROWS = 5_000;
export const MAX_BULK_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface ParsedBulkRow {
  rowNumber: number;
  values: Record<(typeof BULK_UPLOAD_COLUMNS)[number], string | number | undefined>;
}

export interface ParsedBulkWorkbook {
  rows: ParsedBulkRow[];
}

function xmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

/** Minimal, bounded ZIP reader for the XML parts in an XLSX package. */
function unzip(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('The uploaded file is not a valid .xlsx workbook.');
  const endSignature = 0x06054b50;
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === endSignature) { end = offset; break; }
  }
  if (end < 0) throw new Error('The uploaded .xlsx workbook is malformed.');
  const entryCount = buffer.readUInt16LE(end + 10);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (entryCount > 10_000) throw new Error('The uploaded workbook contains too many package entries.');
  const files = new Map<string, Buffer>();
  let cursor = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('The uploaded .xlsx workbook directory is malformed.');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    if (name.includes('..') || name.startsWith('/')) throw new Error('The uploaded workbook contains an unsafe package path.');
    expandedBytes += uncompressedSize;
    if (expandedBytes > 25 * 1024 * 1024) throw new Error('The uploaded workbook expands beyond the permitted size.');
    if (!name.endsWith('/')) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('The uploaded workbook contains a malformed package entry.');
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(start, start + compressedSize);
      if (method === 0) files.set(name, Buffer.from(compressed));
      else if (method === 8) files.set(name, inflateRawSync(compressed, { maxOutputLength: 25 * 1024 * 1024 }));
      else throw new Error('The uploaded workbook uses an unsupported compression method.');
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function requiredXml(files: Map<string, Buffer>, path: string): string {
  const part = files.get(path);
  if (!part) throw new Error(`The uploaded workbook is missing required part '${path}'.`);
  return part.toString('utf8');
}

function relationshipTarget(files: Map<string, Buffer>, relationshipId: string): string {
  const relationships = requiredXml(files, 'xl/_rels/workbook.xml.rels');
  const match = [...relationships.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)]
    .find((entry) => new RegExp(`\\bId=["']${relationshipId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(entry[1]));
  const target = match?.[1].match(/\bTarget=["']([^"']+)["']/)?.[1];
  if (!target || target.includes('..')) throw new Error(`The '${BULK_UPLOAD_SHEET}' worksheet relationship is invalid.`);
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

function sharedStrings(files: Map<string, Buffer>): string[] {
  const xml = files.get('xl/sharedStrings.xml')?.toString('utf8');
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => xmlText(text[1])).join(''));
}

function columnNumber(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? '';
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function cellValue(cell: string, type: string | undefined, strings: string[]): string | number | undefined {
  if (/<f\b/i.test(cell)) throw new Error('Formula cells are not permitted in bulk uploads.');
  const inline = cell.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)?.[1];
  if (inline !== undefined) return [...inline.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => xmlText(part[1])).join('');
  const raw = cell.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1];
  if (raw === undefined) return undefined;
  if (type === 's') return strings[Number(raw)];
  if (type === 'str') return xmlText(raw);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : xmlText(raw);
}

export function parseBulkUploadWorkbook(buffer: Buffer): ParsedBulkWorkbook {
  if (buffer.length > MAX_BULK_UPLOAD_BYTES) throw new Error('Excel file must be 5 MB or smaller.');
  const files = unzip(buffer);
  const workbook = requiredXml(files, 'xl/workbook.xml');
  const sheet = [...workbook.matchAll(/<sheet\b([^>]+)\/?\s*>/g)].find((entry) => entry[1].match(/\bname=["']([^"']+)["']/)?.[1] === BULK_UPLOAD_SHEET);
  if (!sheet) throw new Error(`Worksheet '${BULK_UPLOAD_SHEET}' was not found.`);
  const relationshipId = sheet[1].match(/\br:id=["']([^"']+)["']/)?.[1];
  if (!relationshipId) throw new Error(`Worksheet '${BULK_UPLOAD_SHEET}' is malformed.`);
  const worksheet = requiredXml(files, relationshipTarget(files, relationshipId));
  const strings = sharedStrings(files);
  const parsedRows = [...worksheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)].map((rowMatch, index) => {
    const rowNumber = Number(rowMatch[1].match(/\br=["'](\d+)["']/)?.[1] ?? index + 1);
    const cells: Array<string | number | undefined> = [];
    for (const match of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const ref = match[1].match(/\br=["']([^"']+)["']/)?.[1] ?? `A${rowNumber}`;
      const type = match[1].match(/\bt=["']([^"']+)["']/)?.[1];
      cells[columnNumber(ref)] = cellValue(match[2], type, strings);
    }
    return { rowNumber, cells };
  });
  const header = parsedRows[0];
  if (!header) throw new Error(`Worksheet '${BULK_UPLOAD_SHEET}' is empty.`);
  const indexes = new Map<string, number>();
  header.cells.forEach((value, index) => indexes.set(String(value ?? '').trim(), index));
  for (const column of BULK_UPLOAD_COLUMNS) if (!indexes.has(column)) throw new Error(`Required column '${column}' was not found.`);
  const rows: ParsedBulkRow[] = [];
  for (const row of parsedRows.slice(1)) {
    const values = Object.fromEntries(BULK_UPLOAD_COLUMNS.map((column) => [column, row.cells[indexes.get(column)!]])) as ParsedBulkRow['values'];
    if (BULK_UPLOAD_COLUMNS.every((column) => values[column] === undefined || String(values[column]).trim() === '')) continue;
    rows.push({ rowNumber: row.rowNumber, values });
    if (rows.length > MAX_BULK_UPLOAD_ROWS) throw new Error(`Bulk uploads are limited to ${MAX_BULK_UPLOAD_ROWS} menu rows.`);
  }
  return { rows };
}
