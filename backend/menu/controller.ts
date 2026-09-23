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
  type MenuMutationContext,
} from './service';

export const AdminMenuApi = {
  list: () => adminListMenu(),
  createCategory: (input: CategoryInput, context?: MenuMutationContext) => adminCreateCategory(input, context),
  updateCategory: (id: string, input: Partial<CategoryInput>, context?: MenuMutationContext) => adminUpdateCategory(id, input, context),
  deleteCategory: (id: string, context?: MenuMutationContext) => adminDeleteCategory(id, context),
  createItem: (input: ItemInput, context?: MenuMutationContext) => adminCreateItem(input, context),
  updateItem: (id: string, input: Partial<ItemInput>, context?: MenuMutationContext) => adminUpdateItem(id, input, context),
  deleteItem: (id: string, context?: MenuMutationContext) => adminDeleteItem(id, context),
  setAvailability: (id: string, isAvailable: boolean, context?: MenuMutationContext) => adminSetItemAvailability(id, isAvailable, context),
  setPromotional: (id: string, isPromotional: boolean, context?: MenuMutationContext) => adminSetItemPromotionalFlag(id, isPromotional, context),
};
