import { getCurrentBranchId } from '../config/branch';
import { createInventoryMasterItem } from '../inventory/service';
import { isConfiguredPrepStation, normalizePrepStationId } from '../config/posSettings';
import {
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  getCategoryById,
  getCategoryByName,
  getItemById,
  getItemByNameInCategory,
  listCategories,
  listItems,
  updateCategory,
  updateItem,
  type MenuCategoryRecord,
  type MenuItemRecord,
} from './repository';

export interface CategoryInput {
  branchId?: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface ItemInput {
  branchId?: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  prepStation?: string;
  taxMode?: 'taxable' | 'tax_exempt';
  taxRate?: number;
  inventoryItemId?: string;
  inventoryUnit?: string;
  inventoryMinimumThreshold?: number;
  inventoryCurrentStock?: number;
  isAvailable?: boolean;
  isActive?: boolean;
  isPromotional?: boolean;
}

const PRICE_MAX = 999999.99;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeValidStation(station: string | undefined): string | undefined {
  if (station === undefined || station === '') return undefined;
  const normalized = normalizePrepStationId(station);
  if (!isConfiguredPrepStation(normalized)) throw new Error(`prepStation must be one of the configured prep stations.`);
  return normalized;
}

function assertValidTaxMetadata(taxMode: string | undefined, taxRate: number | undefined): void {
  if (taxMode !== undefined && taxMode !== 'taxable' && taxMode !== 'tax_exempt') throw new Error('taxMode must be taxable or tax_exempt.');
  if (taxRate !== undefined) assertValidPrice(taxRate);
}

function assertValidPrice(price: number): void {
  if (!Number.isFinite(price)) throw new Error('Price must be a valid number.');
  if (price < 0) throw new Error('Price cannot be negative.');
  if (price > PRICE_MAX) throw new Error(`Price cannot exceed ${PRICE_MAX}.`);
  if (Math.round(price * 100) !== price * 100) throw new Error('Price cannot have more than 2 decimal places.');
}

function assertName(name: string, entity: 'Category' | 'Item'): string {
  const normalized = name.trim();
  if (!normalized) throw new Error(`${entity} name is required.`);
  return normalized;
}

async function createLinkedInventoryItemForMenuItem(menuItem: MenuItemRecord, input: ItemInput): Promise<string> {
  const inventoryItem = await createInventoryMasterItem({
    branchId: menuItem.branchId,
    sku: `MENU-${menuItem.id}`,
    name: menuItem.name,
    unit: input.inventoryUnit?.trim() || 'each',
    minimumThreshold: input.inventoryMinimumThreshold ?? 0,
    currentStock: input.inventoryCurrentStock ?? 0,
  });
  return inventoryItem.id;
}

export async function adminListMenu() {
  const categories = await listCategories();
  const items = await listItems();

  return categories.map((category) => ({
    ...category,
    items: items.filter((item) => item.categoryId === category.id),
  }));
}

export async function adminCreateCategory(input: CategoryInput): Promise<MenuCategoryRecord> {
  const name = assertName(input.name, 'Category');
  const duplicate = await getCategoryByName(name);
  if (duplicate) throw new Error(`Category '${name}' already exists.`);

  const record: MenuCategoryRecord = {
    id: createId('cat'),
    branchId: input.branchId ?? getCurrentBranchId(),
    name,
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  return createCategory(record);
}

export async function adminUpdateCategory(id: string, input: Partial<CategoryInput>) {
  const category = await getCategoryById(id);
  if (!category) throw new Error('Category not found.');

  if (input.name) {
    const name = assertName(input.name, 'Category');
    const duplicate = await getCategoryByName(name);
    if (duplicate && duplicate.id !== id) throw new Error(`Category '${name}' already exists.`);
    input.name = name;
  }

  return updateCategory(id, {
    ...input,
    updatedAt: nowIso(),
  });
}

export async function adminDeleteCategory(id: string): Promise<boolean> {
  return deleteCategory(id);
}

export async function adminCreateItem(input: ItemInput): Promise<MenuItemRecord> {
  const category = await getCategoryById(input.categoryId);
  if (!category) throw new Error('Category not found.');

  const name = assertName(input.name, 'Item');
  assertValidPrice(input.price);
  const prepStation = normalizeValidStation(input.prepStation);
  assertValidTaxMetadata(input.taxMode, input.taxRate);

  const duplicate = await getItemByNameInCategory(input.categoryId, name);
  if (duplicate) throw new Error(`Item '${name}' already exists in this category.`);

  const now = nowIso();
  const menuItem = await createItem({
    id: createId('item'),
    branchId: input.branchId ?? category.branchId ?? getCurrentBranchId(),
    categoryId: input.categoryId,
    name,
    description: input.description?.trim() || undefined,
    price: Math.round(input.price * 100) / 100,
    prepStation,
    taxMode: input.taxMode ?? 'taxable',
    taxRate: input.taxRate !== undefined ? Math.round(input.taxRate * 100) / 100 : 0,
    inventoryItemId: input.inventoryItemId,
    isAvailable: input.isAvailable ?? true,
    isActive: input.isActive ?? true,
    isPromotional: input.isPromotional ?? false,
    createdAt: now,
    updatedAt: now,
  });

  if (menuItem.inventoryItemId) return menuItem;

  const inventoryItemId = await createLinkedInventoryItemForMenuItem(menuItem, input);
  const linkedMenuItem = await updateItem(menuItem.id, { inventoryItemId, updatedAt: nowIso() });
  if (!linkedMenuItem) throw new Error('Menu item not found after linked inventory creation.');
  return linkedMenuItem;
}

export async function adminUpdateItem(id: string, input: Partial<ItemInput>) {
  const item = await getItemById(id);
  if (!item) throw new Error('Menu item not found.');

  const nextCategoryId = input.categoryId ?? item.categoryId;
  if (input.categoryId) {
    const category = await getCategoryById(input.categoryId);
    if (!category) throw new Error('Category not found.');
  }

  if (typeof input.price === 'number') {
    assertValidPrice(input.price);
  }
  if (input.prepStation !== undefined) input.prepStation = normalizeValidStation(input.prepStation);
  assertValidTaxMetadata(input.taxMode, input.taxRate);

  if (input.name) {
    const name = assertName(input.name, 'Item');
    const duplicate = await getItemByNameInCategory(nextCategoryId, name);
    if (duplicate && duplicate.id !== id) throw new Error(`Item '${name}' already exists in this category.`);
    input.name = name;
  }

  const { inventoryUnit, inventoryMinimumThreshold, inventoryCurrentStock, ...menuPatch } = input;
  void inventoryUnit;
  void inventoryMinimumThreshold;
  void inventoryCurrentStock;

  return updateItem(id, {
    ...menuPatch,
    description: input.description?.trim(),
    price: typeof input.price === 'number' ? Math.round(input.price * 100) / 100 : undefined,
    taxRate: typeof input.taxRate === 'number' ? Math.round(input.taxRate * 100) / 100 : undefined,
    updatedAt: nowIso(),
  });
}

export async function adminDeleteItem(id: string): Promise<boolean> {
  return deleteItem(id);
}

export async function adminSetItemAvailability(id: string, isAvailable: boolean) {
  const item = await getItemById(id);
  if (!item) throw new Error('Menu item not found.');
  return updateItem(id, { isAvailable, updatedAt: nowIso() });
}

export async function adminSetItemPromotionalFlag(id: string, isPromotional: boolean) {
  const item = await getItemById(id);
  if (!item) throw new Error('Menu item not found.');
  return updateItem(id, { isPromotional, updatedAt: nowIso() });
}
