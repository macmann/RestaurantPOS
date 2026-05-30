import { isSqlRepositoryEnabled } from '../db/client';
import { deleteRecord, getRecord, listRecords, putRecord } from '../db/repositoryStore';

export interface MenuCategoryRecord {
  id: string;
  branchId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MenuPrepStation = 'kitchen' | 'bar';
export type MenuTaxMode = 'taxable' | 'tax_exempt';

export interface MenuItemRecord {
  id: string;
  branchId: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  prepStation?: MenuPrepStation;
  taxMode?: MenuTaxMode;
  taxRate?: number;
  inventoryItemId?: string;
  isAvailable: boolean;
  isActive: boolean;
  isPromotional: boolean;
  createdAt: string;
  updatedAt: string;
}

const categories = new Map<string, MenuCategoryRecord>();
const items = new Map<string, MenuItemRecord>();

export async function listCategories(): Promise<MenuCategoryRecord[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<MenuCategoryRecord>('menu:categories') : [...categories.values()];
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function getCategoryById(id: string): Promise<MenuCategoryRecord | null> {
  if (isSqlRepositoryEnabled()) return getRecord<MenuCategoryRecord>('menu:categories', id);
  return categories.get(id) ?? null;
}

export async function getCategoryByName(name: string): Promise<MenuCategoryRecord | null> {
  const normalized = name.trim().toLowerCase();
  const rows = isSqlRepositoryEnabled() ? await listRecords<MenuCategoryRecord>('menu:categories') : [...categories.values()];
  for (const category of rows) {
    if (category.name.trim().toLowerCase() === normalized) return category;
  }
  return null;
}

export async function createCategory(record: MenuCategoryRecord): Promise<MenuCategoryRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('menu:categories', record.id, record);
  categories.set(record.id, record);
  return record;
}

export async function updateCategory(id: string, patch: Partial<MenuCategoryRecord>): Promise<MenuCategoryRecord | null> {
  const current = isSqlRepositoryEnabled() ? await getRecord<MenuCategoryRecord>('menu:categories', id) : categories.get(id);
  if (!current) return null;

  const next = { ...current, ...patch, id: current.id };
  if (isSqlRepositoryEnabled()) return putRecord('menu:categories', id, next);
  categories.set(id, next);
  return next;
}

export async function deleteCategory(id: string): Promise<boolean> {
  const itemRows = isSqlRepositoryEnabled() ? await listRecords<MenuItemRecord>('menu:items') : [...items.values()];
  for (const item of itemRows) {
    if (item.categoryId === id) {
      if (isSqlRepositoryEnabled()) await deleteRecord('menu:items', item.id);
      else items.delete(item.id);
    }
  }

  return isSqlRepositoryEnabled() ? deleteRecord('menu:categories', id) : categories.delete(id);
}

export async function listItems(categoryId?: string): Promise<MenuItemRecord[]> {
  const all = isSqlRepositoryEnabled() ? await listRecords<MenuItemRecord>('menu:items') : [...items.values()];
  return categoryId ? all.filter((item) => item.categoryId === categoryId) : all;
}

export async function getItemById(id: string): Promise<MenuItemRecord | null> {
  if (isSqlRepositoryEnabled()) return getRecord<MenuItemRecord>('menu:items', id);
  return items.get(id) ?? null;
}

export async function getItemByNameInCategory(categoryId: string, name: string): Promise<MenuItemRecord | null> {
  const normalized = name.trim().toLowerCase();
  const itemRows = isSqlRepositoryEnabled() ? await listRecords<MenuItemRecord>('menu:items') : [...items.values()];
  for (const item of itemRows) {
    if (item.categoryId === categoryId && item.name.trim().toLowerCase() === normalized) return item;
  }
  return null;
}

export async function createItem(record: MenuItemRecord): Promise<MenuItemRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('menu:items', record.id, record);
  items.set(record.id, record);
  return record;
}

export async function updateItem(id: string, patch: Partial<MenuItemRecord>): Promise<MenuItemRecord | null> {
  const current = isSqlRepositoryEnabled() ? await getRecord<MenuItemRecord>('menu:items', id) : items.get(id);
  if (!current) return null;

  const next = { ...current, ...patch, id: current.id };
  if (isSqlRepositoryEnabled()) return putRecord('menu:items', id, next);
  items.set(id, next);
  return next;
}

export async function deleteItem(id: string): Promise<boolean> {
  return isSqlRepositoryEnabled() ? deleteRecord('menu:items', id) : items.delete(id);
}
