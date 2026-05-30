import { isSqlRepositoryEnabled } from '../db/client';
import { getRecord, listRecords, putRecord } from '../db/repositoryStore';

export type StockMovementType = 'sale_deduction' | 'manual_adjustment' | 'wastage' | 'restock';

export interface InventoryItemRecord {
  id: string;
  branchId: string;
  sku: string;
  name: string;
  unit: string;
  minimumThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementRecord {
  id: string;
  branchId: string;
  itemId: string;
  movementType: StockMovementType;
  quantityDelta: number;
  reason?: string;
  referenceId?: string;
  actorUserId?: string;
  createdAt: string;
}

const inventoryItems = new Map<string, InventoryItemRecord>();
const movementLedger = new Map<string, StockMovementRecord>();

export async function createInventoryItem(record: InventoryItemRecord): Promise<InventoryItemRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('inventory:items', record.id, record);
  inventoryItems.set(record.id, structuredClone(record));
  return structuredClone(record);
}

export async function updateInventoryItem(id: string, patch: Partial<InventoryItemRecord>): Promise<InventoryItemRecord | null> {
  const current = isSqlRepositoryEnabled() ? await getRecord<InventoryItemRecord>('inventory:items', id) : inventoryItems.get(id);
  if (!current) return null;
  const next = { ...current, ...patch, id: current.id };
  if (isSqlRepositoryEnabled()) return putRecord('inventory:items', id, next);
  inventoryItems.set(id, structuredClone(next));
  return structuredClone(next);
}

export async function getInventoryItemById(id: string): Promise<InventoryItemRecord | null> {
  if (isSqlRepositoryEnabled()) return getRecord<InventoryItemRecord>('inventory:items', id);
  const row = inventoryItems.get(id);
  return row ? structuredClone(row) : null;
}

export async function getInventoryItemBySku(sku: string): Promise<InventoryItemRecord | null> {
  const normalized = sku.trim().toLowerCase();
  const rows = isSqlRepositoryEnabled() ? await listRecords<InventoryItemRecord>('inventory:items') : [...inventoryItems.values()];
  for (const row of rows) {
    if (row.sku.trim().toLowerCase() === normalized) return structuredClone(row);
  }
  return null;
}

export async function listInventoryItems(): Promise<InventoryItemRecord[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<InventoryItemRecord>('inventory:items') : [...inventoryItems.values()];
  return rows.map((row) => structuredClone(row));
}

export async function createStockMovement(record: StockMovementRecord): Promise<StockMovementRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('inventory:movements', record.id, record);
  movementLedger.set(record.id, structuredClone(record));
  return structuredClone(record);
}

export async function listStockMovements(itemId?: string): Promise<StockMovementRecord[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<StockMovementRecord>('inventory:movements') : [...movementLedger.values()];
  const filtered = itemId ? rows.filter((row) => row.itemId === itemId) : rows;
  return filtered
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => structuredClone(row));
}
