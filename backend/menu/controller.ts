import {
  adminCreateCategory,
  adminCreateItem,
  adminDeleteCategory,
  adminDeleteItem,
  adminListMenu,
  adminSetItemAvailability,
  adminSetItemPromotionalFlag,
  adminUpdateCategory,
  adminUpdateItem,
  type CategoryInput,
  type ItemInput,
} from './service';

export const AdminMenuApi = {
  list: () => adminListMenu(),
  createCategory: (input: CategoryInput) => adminCreateCategory(input),
  updateCategory: (id: string, input: Partial<CategoryInput>) => adminUpdateCategory(id, input),
  deleteCategory: (id: string) => adminDeleteCategory(id),
  createItem: (input: ItemInput) => adminCreateItem(input),
  updateItem: (id: string, input: Partial<ItemInput>) => adminUpdateItem(id, input),
  deleteItem: (id: string) => adminDeleteItem(id),
  setAvailability: (id: string, isAvailable: boolean) => adminSetItemAvailability(id, isAvailable),
  setPromotional: (id: string, isPromotional: boolean) => adminSetItemPromotionalFlag(id, isPromotional),
};
