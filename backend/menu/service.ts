import { getCurrentBranchId } from '../config/branch';
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
  isAvailable?: boolean;
  isPromotional?: boolean;
}

const PRICE_MAX = 999999.99;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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

  const duplicate = await getItemByNameInCategory(input.categoryId, name);
  if (duplicate) throw new Error(`Item '${name}' already exists in this category.`);

  const now = nowIso();
  return createItem({
    id: createId('item'),
    branchId: input.branchId ?? category.branchId ?? getCurrentBranchId(),
    categoryId: input.categoryId,
    name,
    description: input.description?.trim() || undefined,
    price: Math.round(input.price * 100) / 100,
    isAvailable: input.isAvailable ?? true,
    isPromotional: input.isPromotional ?? false,
    createdAt: now,
    updatedAt: now,
  });
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

  if (input.name) {
    const name = assertName(input.name, 'Item');
    const duplicate = await getItemByNameInCategory(nextCategoryId, name);
    if (duplicate && duplicate.id !== id) throw new Error(`Item '${name}' already exists in this category.`);
    input.name = name;
  }

  return updateItem(id, {
    ...input,
    description: input.description?.trim(),
    price: typeof input.price === 'number' ? Math.round(input.price * 100) / 100 : undefined,
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
