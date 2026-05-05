export type StockMovementType = 'sale_deduction' | 'manual_adjustment' | 'wastage' | 'restock';

export interface InventoryItemRecord {
  id: string;
  sku: string;
  name: string;
  unit: string;
  minimumThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementRecord {
  id: string;
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
  inventoryItems.set(record.id, structuredClone(record));
  return structuredClone(record);
}

export async function updateInventoryItem(id: string, patch: Partial<InventoryItemRecord>): Promise<InventoryItemRecord | null> {
  const current = inventoryItems.get(id);
  if (!current) return null;
  const next = { ...current, ...patch, id: current.id };
  inventoryItems.set(id, structuredClone(next));
  return structuredClone(next);
}

export async function getInventoryItemById(id: string): Promise<InventoryItemRecord | null> {
  const row = inventoryItems.get(id);
  return row ? structuredClone(row) : null;
}

export async function getInventoryItemBySku(sku: string): Promise<InventoryItemRecord | null> {
  const normalized = sku.trim().toLowerCase();
  for (const row of inventoryItems.values()) {
    if (row.sku.trim().toLowerCase() === normalized) return structuredClone(row);
  }
  return null;
}

export async function listInventoryItems(): Promise<InventoryItemRecord[]> {
  return [...inventoryItems.values()].map((row) => structuredClone(row));
}

export async function createStockMovement(record: StockMovementRecord): Promise<StockMovementRecord> {
  movementLedger.set(record.id, structuredClone(record));
  return structuredClone(record);
}

export async function listStockMovements(itemId?: string): Promise<StockMovementRecord[]> {
  const rows = [...movementLedger.values()];
  const filtered = itemId ? rows.filter((row) => row.itemId === itemId) : rows;
  return filtered
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => structuredClone(row));
}
