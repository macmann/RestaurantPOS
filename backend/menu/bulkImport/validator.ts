import type { ParsedBulkWorkbook } from './parser';

export interface BulkImportRow {
  rowNumber: number;
  name: string;
  category: string;
  station: string;
  price: number;
}

export interface BulkImportValidationError {
  rowNumber: number;
  field: 'Name' | 'Category' | 'Station' | 'Price';
  value: unknown;
  message: string;
}

export function validateBulkUploadRows(workbook: ParsedBulkWorkbook): { rows: BulkImportRow[]; errors: BulkImportValidationError[] } {
  const rows: BulkImportRow[] = [];
  const errors: BulkImportValidationError[] = [];
  const identities = new Set<string>();
  for (const source of workbook.rows) {
    const name = String(source.values.Name ?? '').trim();
    const category = String(source.values.Category ?? '').trim();
    const station = String(source.values.Station ?? '').trim();
    const rawPrice = source.values.Price;
    const priceText = typeof rawPrice === 'string' ? rawPrice.trim() : rawPrice;
    const price = typeof priceText === 'number' ? priceText : Number(priceText);
    if (!name) errors.push({ rowNumber: source.rowNumber, field: 'Name', value: source.values.Name ?? '', message: 'Name is required.' });
    if (!category) errors.push({ rowNumber: source.rowNumber, field: 'Category', value: source.values.Category ?? '', message: 'Category is required.' });
    if (!station) errors.push({ rowNumber: source.rowNumber, field: 'Station', value: source.values.Station ?? '', message: 'Station is required.' });
    if (rawPrice === undefined || priceText === '') errors.push({ rowNumber: source.rowNumber, field: 'Price', value: rawPrice ?? '', message: 'Price is required.' });
    else if (!Number.isFinite(price)) errors.push({ rowNumber: source.rowNumber, field: 'Price', value: rawPrice, message: 'Price must be a number.' });
    else if (price < 0) errors.push({ rowNumber: source.rowNumber, field: 'Price', value: rawPrice, message: 'Price must be greater than or equal to 0.' });
    else if (price > 999999.99 || Math.round(price * 100) !== price * 100) errors.push({ rowNumber: source.rowNumber, field: 'Price', value: rawPrice, message: 'Price must be at most 999999.99 with no more than 2 decimal places.' });
    const identity = `${category.toLocaleLowerCase()}\u0000${name.toLocaleLowerCase()}`;
    if (name && category && identities.has(identity)) errors.push({ rowNumber: source.rowNumber, field: 'Name', value: source.values.Name ?? '', message: 'Duplicate item name and category in workbook.' });
    if (name && category && station && !identities.has(identity) && Number.isFinite(price) && price >= 0 && price <= 999999.99 && Math.round(price * 100) === price * 100) {
      rows.push({ rowNumber: source.rowNumber, name, category, station, price });
      identities.add(identity);
    }
  }
  return { rows, errors };
}
