import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import {
  createInventoryItem,
  createStockMovement,
  getInventoryItemById,
  getInventoryItemBySku,
  listInventoryItems,
  listStockMovements,
  type InventoryItemRecord,
  type StockMovementRecord,
  type StockMovementType,
} from './repository';

export type DeductionTriggerPolicy = 'on_in_preparation' | 'on_completed' | 'manual';

export interface InventoryItemInput {
  sku: string;
  name: string;
  unit: string;
  minimumThreshold: number;
  currentStock: number;
}

export interface StockMovementInput {
  itemId: string;
  movementType: StockMovementType;
  quantityDelta: number;
  reason?: string;
  referenceId?: string;
}

export interface LowStockAlert {
  alertId: string;
  itemId: string;
  sku: string;
  itemName: string;
  unit: string;
  minimumThreshold: number;
  currentBalance: number;
  severity: 'warning' | 'critical';
  triggeredAt: string;
}

let deductionTriggerPolicy: DeductionTriggerPolicy = 'on_in_preparation';

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function validateNonNegative(num: number, field: string): void {
  if (!Number.isFinite(num) || num < 0) throw new Error(`${field} must be a non-negative number.`);
}

function validateNonZero(num: number, field: string): void {
  if (!Number.isFinite(num) || num === 0) throw new Error(`${field} must be a non-zero number.`);
}

function normalizeText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

export async function createInventoryMasterItem(input: InventoryItemInput): Promise<InventoryItemRecord> {
  const sku = normalizeText(input.sku, 'sku');
  const name = normalizeText(input.name, 'name');
  const unit = normalizeText(input.unit, 'unit');
  validateNonNegative(input.minimumThreshold, 'minimumThreshold');
  validateNonNegative(input.currentStock, 'currentStock');

  const duplicate = await getInventoryItemBySku(sku);
  if (duplicate) throw new Error(`Inventory SKU '${sku}' already exists.`);

  const now = new Date().toISOString();
  const item = await createInventoryItem({
    id: createId('inv'),
    sku,
    name,
    unit,
    minimumThreshold: input.minimumThreshold,
    createdAt: now,
    updatedAt: now,
  });

  if (input.currentStock > 0) {
    await appendStockMovement({
      itemId: item.id,
      movementType: 'restock',
      quantityDelta: input.currentStock,
      reason: 'Initial stock at item creation',
    });
  }

  return item;
}

export async function appendStockMovement(input: StockMovementInput, actorUserId?: string): Promise<StockMovementRecord> {
  const item = await getInventoryItemById(input.itemId);
  if (!item) throw new Error('Inventory item not found.');

  validateNonZero(input.quantityDelta, 'quantityDelta');

  const row: StockMovementRecord = {
    id: createId('mov'),
    itemId: input.itemId,
    movementType: input.movementType,
    quantityDelta: input.quantityDelta,
    reason: input.reason?.trim() || undefined,
    referenceId: input.referenceId,
    actorUserId,
    createdAt: new Date().toISOString(),
  };

  return createStockMovement(row);
}

export async function getCurrentBalance(itemId: string): Promise<number> {
  const movements = await listStockMovements(itemId);
  return Math.round(movements.reduce((sum, row) => sum + row.quantityDelta, 0) * 1000) / 1000;
}

export async function setDeductionTriggerPolicy(user: AuthenticatedUser, policy: DeductionTriggerPolicy): Promise<DeductionTriggerPolicy> {
  if (!can(user, Actions.AdjustStock)) throw new Error('Forbidden: cannot configure inventory policy.');
  deductionTriggerPolicy = policy;
  return deductionTriggerPolicy;
}

export function getDeductionTriggerPolicy(): DeductionTriggerPolicy {
  return deductionTriggerPolicy;
}

export async function listInventoryWithBalances() {
  const items = await listInventoryItems();
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      currentBalance: await getCurrentBalance(item.id),
    })),
  );
}

export async function listLowStockAlerts(): Promise<LowStockAlert[]> {
  const items = await listInventoryWithBalances();
  const now = new Date().toISOString();

  return items
    .filter((item) => item.currentBalance <= item.minimumThreshold)
    .map((item) => ({
      alertId: `alert_${item.id}`,
      itemId: item.id,
      sku: item.sku,
      itemName: item.name,
      unit: item.unit,
      minimumThreshold: item.minimumThreshold,
      currentBalance: item.currentBalance,
      severity: item.currentBalance <= item.minimumThreshold * 0.5 ? 'critical' : 'warning',
      triggeredAt: now,
    }));
}
