import { queueMenuEvent } from '../../sync/menuEvents';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../auth/policies';
import { recordAuditEvent } from '../../audit/service';
import { getCurrentBranchId } from '../../config/branch';
import { getPosOperationalSettings, normalizePrepStationId, savePosOperationalSettings, updatePosOperationalSettings } from '../../config/posSettings';
import { isSqlRepositoryEnabled, query, withTransaction } from '../../db/client';
import { getItemByNameInCategory, listCategories, restoreMemoryMenu, snapshotMemoryMenu } from '../repository';
import { adminCreateCategory, adminCreateItem, adminUpdateItem } from '../service';
import { parseBulkUploadWorkbook } from './parser';
import { validateBulkUploadRows, type BulkImportRow, type BulkImportValidationError } from './validator';

export type BulkImportAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';
export interface BulkImportPreviewRow extends BulkImportRow { action: BulkImportAction }
export interface BulkImportPreview {
  token?: string;
  filename: string;
  rowCount: number;
  categories: { total: number; existing: number; create: number; toCreate: string[] };
  stations: { total: number; existing: number; create: number; toCreate: string[] };
  items: { create: number; update: number; unchanged: number; invalid: number };
  rows: BulkImportPreviewRow[];
  errors: BulkImportValidationError[];
}
export interface BulkImportResult {
  filename: string; rowsProcessed: number; categoriesCreated: number; stationsCreated: number;
  itemsCreated: number; itemsUpdated: number; unchanged: number; syncEventsQueued: number;
  syncMessage: string;
}

export interface BulkImportContext { branchId: string; source: 'LOCAL_POS' | 'CLOUD_MANAGER' }
const localContext = (): BulkImportContext => ({ branchId: getCurrentBranchId(), source: 'LOCAL_POS' });

interface TokenRecord { source: BulkImportContext['source']; userId: string; branchId: string; filename: string; rows: BulkImportRow[]; expiresAt: number }
const tokens = new Map<string, TokenRecord>();
const TOKEN_TTL_MS = 10 * 60 * 1000;

function normalized(value: string): string { return value.trim().toLocaleLowerCase(); }
function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => { const key = normalized(value); if (seen.has(key)) return false; seen.add(key); return true; });
}

async function buildPreview(filename: string, rows: BulkImportRow[], errors: BulkImportValidationError[] = [], branchId = getCurrentBranchId()): Promise<BulkImportPreview> {
  const categories = (await listCategories()).filter((row) => row.branchId === branchId && row.isActive);
  const categoryNames = uniqueInOrder(rows.map((row) => row.category));
  const categoryByName = new Map(categories.map((row) => [normalized(row.name), row]));
  const settings = getPosOperationalSettings();
  const stationNames = uniqueInOrder(rows.map((row) => row.station));
  const stationByCode = new Map(settings.prepStations.filter((row) => row.enabled).map((row) => [row.id, row]));
  const previewRows: BulkImportPreviewRow[] = [];
  for (const row of rows) {
    const category = categoryByName.get(normalized(row.category));
    if (!category) { previewRows.push({ ...row, action: 'CREATE' }); continue; }
    const existing = await getItemByNameInCategory(category.id, row.name);
    if (!existing) previewRows.push({ ...row, action: 'CREATE' });
    else {
      const unchanged = existing.categoryId === category.id && existing.price === row.price
        && existing.prepStation === normalizePrepStationId(row.station) && existing.isActive && existing.isAvailable;
      previewRows.push({ ...row, action: unchanged ? 'UNCHANGED' : 'UPDATE' });
    }
  }
  const categoriesToCreate = categoryNames.filter((name) => !categoryByName.has(normalized(name)));
  const stationsToCreate = stationNames.filter((name) => !stationByCode.has(normalizePrepStationId(name)));
  return {
    filename, rowCount: rows.length,
    categories: { total: categoryNames.length, existing: categoryNames.length - categoriesToCreate.length, create: categoriesToCreate.length, toCreate: categoriesToCreate },
    stations: { total: stationNames.length, existing: stationNames.length - stationsToCreate.length, create: stationsToCreate.length, toCreate: stationsToCreate },
    items: {
      create: previewRows.filter((row) => row.action === 'CREATE').length,
      update: previewRows.filter((row) => row.action === 'UPDATE').length,
      unchanged: previewRows.filter((row) => row.action === 'UNCHANGED').length,
      invalid: errors.length,
    },
    rows: previewRows, errors,
  };
}

export async function previewBulkImport(user: AuthenticatedUser, filename: string, file: Buffer, context: BulkImportContext = localContext()): Promise<BulkImportPreview> {
  const parsed = parseBulkUploadWorkbook(file);
  const validated = validateBulkUploadRows(parsed);
  const preview = await buildPreview(filename, validated.rows, validated.errors, context.branchId);
  if (!validated.errors.length) {
    const token = randomUUID();
    tokens.set(token, { userId: user.id, branchId: context.branchId, source: context.source, filename, rows: structuredClone(validated.rows), expiresAt: Date.now() + TOKEN_TTL_MS });
    preview.token = token;
  }
  return preview;
}

async function importRows(user: AuthenticatedUser, record: TokenRecord): Promise<BulkImportResult> {
  const previousSettings = getPosOperationalSettings();
  const memorySnapshot = snapshotMemoryMenu();
  try {
    return await withTransaction(async (client) => {
      const mutation = { source: record.source, actorId: user.id };
      const queueCloudChange = async (eventType: string, changed: any) => {
        if (record.source === 'CLOUD_MANAGER' && isSqlRepositoryEnabled()) {
          await queueMenuEvent(client, record.branchId, eventType, changed);
        }
      };
      const categoryRows = (await listCategories()).filter((row) => row.branchId === record.branchId);
      let nextSort = categoryRows.reduce((maximum, row) => Math.max(maximum, row.sortOrder), 0);
      const categoryByName = new Map(categoryRows.filter((row) => row.isActive).map((row) => [normalized(row.name), row]));
      let categoriesCreated = 0;
      for (const name of uniqueInOrder(record.rows.map((row) => row.category))) {
        if (categoryByName.has(normalized(name))) continue;
        const created = await adminCreateCategory({ branchId: record.branchId, name, sortOrder: ++nextSort, isActive: true }, mutation);
        await queueCloudChange('CATEGORY_CREATED', created);
        categoryByName.set(normalized(name), created); categoriesCreated += 1;
      }

      let stationsCreated = 0;
      const settings = getPosOperationalSettings();
      const stations = [...settings.prepStations];
      let stationSort = stations.reduce((maximum, row) => Math.max(maximum, row.sortOrder), 0);
      for (const name of uniqueInOrder(record.rows.map((row) => row.station))) {
        const id = normalizePrepStationId(name);
        if (stations.some((row) => row.id === id)) continue;
        stationSort += 10;
        stations.push({ id, displayName: name, enabled: true, sortOrder: stationSort }); stationsCreated += 1;
      }
      if (stationsCreated) await savePosOperationalSettings({ prepStations: stations });

      let itemsCreated = 0; let itemsUpdated = 0; let unchanged = 0;
      for (const row of record.rows) {
        const category = categoryByName.get(normalized(row.category));
        if (!category) throw new Error(`Row ${row.rowNumber}: category resolution failed.`);
        const station = normalizePrepStationId(row.station);
        const existing = await getItemByNameInCategory(category.id, row.name);
        if (!existing) {
          const created = await adminCreateItem({ branchId: record.branchId, categoryId: category.id, name: row.name, price: row.price, prepStation: station, isActive: true, isAvailable: true }, mutation);
          await queueCloudChange('MENU_ITEM_CREATED', created);
          itemsCreated += 1;
        } else if (existing.price === row.price && existing.prepStation === station && existing.isActive && existing.isAvailable) unchanged += 1;
        else {
          const updated = await adminUpdateItem(existing.id, { categoryId: category.id, price: row.price, prepStation: station, isActive: true, isAvailable: true }, mutation);
          await queueCloudChange('MENU_ITEM_UPDATED', updated);
          itemsUpdated += 1;
        }
      }
      const syncEventsQueued = isSqlRepositoryEnabled() ? categoriesCreated + itemsCreated + itemsUpdated : 0;
      await recordAuditEvent({
        action: 'MENU_BULK_IMPORT', actor: user, entity: { type: 'menu', id: record.branchId, label: 'Menu bulk import' },
        metadata: { branchId: record.branchId, filename: record.filename, rowCount: record.rows.length, categoriesCreated, stationsCreated, itemsCreated, itemsUpdated, unchanged },
      });
      // Ensure all SQL work (including trigger-produced outbox events) has run before returning.
      if (isSqlRepositoryEnabled()) await query('SELECT 1');
      return { filename: record.filename, rowsProcessed: record.rows.length, categoriesCreated, stationsCreated, itemsCreated, itemsUpdated, unchanged, syncEventsQueued, syncMessage: !isSqlRepositoryEnabled() ? 'Changes saved in memory; durable synchronization requires PostgreSQL.' : record.source === 'CLOUD_MANAGER' ? 'Changes have been queued for synchronization to the restaurant POS.' : 'Changes have been queued for cloud synchronization.' };
    });
  } catch (error) {
    if (!isSqlRepositoryEnabled()) restoreMemoryMenu(memorySnapshot);
    updatePosOperationalSettings(previousSettings);
    throw error;
  }
}

export async function confirmBulkImport(user: AuthenticatedUser, token: string, context: BulkImportContext = localContext()): Promise<BulkImportResult> {
  const record = tokens.get(token);
  tokens.delete(token);
  if (!record || record.expiresAt < Date.now()) throw Object.assign(new Error('Bulk import preview token is invalid or expired.'), { statusCode: 410 });
  if (record.userId !== user.id || record.branchId !== context.branchId || record.source !== context.source) throw Object.assign(new Error('Bulk import preview token does not belong to this user and branch.'), { statusCode: 403 });
  return importRows(user, record);
}

export function clearBulkImportTokens(): void { tokens.clear(); }
