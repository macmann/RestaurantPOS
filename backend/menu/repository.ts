export interface MenuCategoryRecord {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MenuItemRecord {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  isAvailable: boolean;
  isPromotional: boolean;
  createdAt: string;
  updatedAt: string;
}

const categories = new Map<string, MenuCategoryRecord>();
const items = new Map<string, MenuItemRecord>();

export async function listCategories(): Promise<MenuCategoryRecord[]> {
  return [...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function getCategoryById(id: string): Promise<MenuCategoryRecord | null> {
  return categories.get(id) ?? null;
}

export async function getCategoryByName(name: string): Promise<MenuCategoryRecord | null> {
  const normalized = name.trim().toLowerCase();
  for (const category of categories.values()) {
    if (category.name.trim().toLowerCase() === normalized) return category;
  }
  return null;
}

export async function createCategory(record: MenuCategoryRecord): Promise<MenuCategoryRecord> {
  categories.set(record.id, record);
  return record;
}

export async function updateCategory(id: string, patch: Partial<MenuCategoryRecord>): Promise<MenuCategoryRecord | null> {
  const current = categories.get(id);
  if (!current) return null;

  const next = { ...current, ...patch, id: current.id };
  categories.set(id, next);
  return next;
}

export async function deleteCategory(id: string): Promise<boolean> {
  for (const item of items.values()) {
    if (item.categoryId === id) {
      items.delete(item.id);
    }
  }

  return categories.delete(id);
}

export async function listItems(categoryId?: string): Promise<MenuItemRecord[]> {
  const all = [...items.values()];
  return categoryId ? all.filter((item) => item.categoryId === categoryId) : all;
}

export async function getItemById(id: string): Promise<MenuItemRecord | null> {
  return items.get(id) ?? null;
}

export async function getItemByNameInCategory(categoryId: string, name: string): Promise<MenuItemRecord | null> {
  const normalized = name.trim().toLowerCase();
  for (const item of items.values()) {
    if (item.categoryId === categoryId && item.name.trim().toLowerCase() === normalized) return item;
  }
  return null;
}

export async function createItem(record: MenuItemRecord): Promise<MenuItemRecord> {
  items.set(record.id, record);
  return record;
}

export async function updateItem(id: string, patch: Partial<MenuItemRecord>): Promise<MenuItemRecord | null> {
  const current = items.get(id);
  if (!current) return null;

  const next = { ...current, ...patch, id: current.id };
  items.set(id, next);
  return next;
}

export async function deleteItem(id: string): Promise<boolean> {
  return items.delete(id);
}
