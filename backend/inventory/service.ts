import { recordAuditEvent } from '../audit/service';
import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import { getCurrentBranchId } from '../config/branch';
import {
  createInventoryItem,
  createInventoryDeduction,
  createStockMovement,
  getInventoryDeductionById,
  getInventoryItemById,
  getInventoryItemBySku,
  listInventoryItems,
  listMenuInventoryRecipes,
  listStockMovements,
  upsertMenuInventoryRecipe,
  type InventoryDeductionRecord,
  type InventoryItemRecord,
  type MenuInventoryRecipeRecord,
  type StockMovementRecord,
  type StockMovementType,
} from './repository';

export type DeductionTriggerPolicy = 'on_in_preparation' | 'on_completed' | 'manual';
export type NegativeStockPolicy = 'prevent' | 'allow';

export interface InventoryItemInput {
  branchId?: string;
  sku: string;
  name: string;
  unit: string;
  minimumThreshold: number;
  currentStock: number;
}

export interface StockMovementInput {
  branchId?: string;
  itemId: string;
  movementType: StockMovementType;
  quantityDelta: number;
  reason?: string;
  referenceId?: string;
  idempotencyKey?: string;
}

export interface MenuInventoryRecipeInput {
  branchId?: string;
  menuItemId: string;
  inventoryItemId: string;
  quantityPerUnit: number;
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
let negativeStockPolicy: NegativeStockPolicy = 'prevent';

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function validateNonNegative(num: number, field: string): void {
  if (!Number.isFinite(num) || num < 0) throw new Error(`${field} must be a non-negative number.`);
}

function validateNonZero(num: number, field: string): void {
  if (!Number.isFinite(num) || num === 0) throw new Error(`${field} must be a non-zero number.`);
}

function validatePositive(num: number, field: string): void {
  if (!Number.isFinite(num) || num <= 0) throw new Error(`${field} must be greater than zero.`);
}

function createStableId(prefix: string, key: string): string {
  return `${prefix}_${key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`;
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
    branchId: input.branchId ?? getCurrentBranchId(),
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
  const beforeBalance = await getCurrentBalance(input.itemId);
  const afterCandidate = Math.round((beforeBalance + input.quantityDelta) * 1000) / 1000;
  if (afterCandidate < 0 && negativeStockPolicy !== 'allow') {
    throw new Error(`Insufficient stock for inventory item ${input.itemId}. Current balance ${beforeBalance}, requested change ${input.quantityDelta}.`);
  }

  const row: StockMovementRecord = {
    id: input.idempotencyKey ? createStableId('mov', input.idempotencyKey) : createId('mov'),
    branchId: input.branchId ?? item.branchId ?? getCurrentBranchId(),
    itemId: input.itemId,
    movementType: input.movementType,
    quantityDelta: input.quantityDelta,
    reason: input.reason?.trim() || undefined,
    referenceId: input.referenceId,
    actorUserId,
    createdAt: new Date().toISOString(),
  };

  const movement = await createStockMovement(row);
  const afterBalance = await getCurrentBalance(input.itemId);

  await recordAuditEvent({
    action: 'stock_adjusted',
    actor: { userId: actorUserId },
    timestamp: movement.createdAt,
    entity: { type: 'inventory_item', id: item.id, label: item.name },
    before: { item, currentBalance: beforeBalance },
    after: { item, currentBalance: afterBalance, movement },
    reason: movement.reason,
    metadata: { movementType: movement.movementType, quantityDelta: movement.quantityDelta, referenceId: movement.referenceId },
  });

  return movement;
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

export async function setNegativeStockPolicy(user: AuthenticatedUser, policy: NegativeStockPolicy): Promise<NegativeStockPolicy> {
  if (!can(user, Actions.AdjustStock)) throw new Error('Forbidden: cannot configure inventory policy.');
  negativeStockPolicy = policy;
  return negativeStockPolicy;
}

export function getNegativeStockPolicy(): NegativeStockPolicy {
  return negativeStockPolicy;
}

export function isNegativeStockAllowed(): boolean {
  return negativeStockPolicy === 'allow';
}

export async function saveMenuInventoryRecipe(input: MenuInventoryRecipeInput): Promise<MenuInventoryRecipeRecord> {
  validatePositive(input.quantityPerUnit, 'quantityPerUnit');
  const inventoryItem = await getInventoryItemById(input.inventoryItemId);
  if (!inventoryItem) throw new Error('Inventory item not found.');

  const now = new Date().toISOString();
  const id = createStableId('recipe', `${input.menuItemId}:${input.inventoryItemId}`);
  return upsertMenuInventoryRecipe({
    id,
    branchId: input.branchId ?? inventoryItem.branchId ?? getCurrentBranchId(),
    menuItemId: input.menuItemId,
    inventoryItemId: input.inventoryItemId,
    quantityPerUnit: Math.round(input.quantityPerUnit * 1000) / 1000,
    createdAt: now,
    updatedAt: now,
  });
}

export async function listRecipeForMenuItem(menuItemId: string): Promise<MenuInventoryRecipeRecord[]> {
  return listMenuInventoryRecipes(menuItemId);
}

export function createDeductionGuardId(orderItemId: string, trigger: string): string {
  return createStableId('deduct', `${orderItemId}:${trigger}`);
}

export async function getCompletedInventoryDeduction(orderItemId: string, trigger: string): Promise<InventoryDeductionRecord | null> {
  return getInventoryDeductionById(createDeductionGuardId(orderItemId, trigger));
}

export async function markInventoryDeductionCompleted(input: {
  branchId: string;
  orderId: string;
  orderItemId: string;
  trigger: string;
}): Promise<InventoryDeductionRecord> {
  const now = new Date().toISOString();
  return createInventoryDeduction({
    id: createDeductionGuardId(input.orderItemId, input.trigger),
    branchId: input.branchId,
    orderId: input.orderId,
    orderItemId: input.orderItemId,
    trigger: input.trigger,
    status: 'completed',
    createdAt: now,
    completedAt: now,
  });
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
