import { hashPassword } from '../auth/service';
import { getCurrentBranchId } from '../config/branch';
import { appendStockMovement, createInventoryMasterItem, getCurrentBalance, saveMenuInventoryRecipe } from '../inventory/service';
import { getInventoryItemBySku } from '../inventory/repository';
import { createCategory, createItem, getCategoryById, getItemById } from '../menu/repository';
import { getTableById, saveTable } from '../tables/repository';
import { getUserRecordById, saveUser } from '../users/repository';

const STARTER_PASSWORD = 'password123';

const starterUsers = [
  { id: 'waiter', username: 'waiter', email: 'waiter@sympos.local', role: ['waitstaff', 'cashier'] },
  { id: 'cashier', username: 'cashier', email: 'cashier@sympos.local', role: 'cashier' },
  { id: 'manager', username: 'manager', email: 'manager@sympos.local', role: 'manager' },
  { id: 'kitchen', username: 'kitchen', email: 'kitchen@sympos.local', role: 'kitchen' },
  { id: 'bar', username: 'bar', email: 'bar@sympos.local', role: 'bar' },
];

const starterTables = [
  { id: 'T1', name: 'Table 1', capacity: 2 },
  { id: 'T2', name: 'Table 2', capacity: 4 },
  { id: 'T3', name: 'Table 3', capacity: 4 },
  { id: 'T4', name: 'Table 4', capacity: 6 },
  { id: 'T5', name: 'Table 5', capacity: 2 },
  { id: 'T6', name: 'Table 6', capacity: 8 },
];

const starterMenu = [
  {
    id: 'cat-mains',
    name: 'Mains',
    sortOrder: 1,
    items: [
      { id: 'menu-tea-leaf-salad', name: 'Tea Leaf Salad', price: 6500, prepStation: 'kitchen' as const, sku: 'DEMO-TEA-LEAF' },
      { id: 'menu-chicken-rice', name: 'Chicken Rice', price: 8500, prepStation: 'kitchen' as const, sku: 'DEMO-CHICKEN-RICE' },
      { id: 'menu-mohinga', name: 'Mohinga', price: 5500, prepStation: 'kitchen' as const, sku: 'DEMO-MOHINGA' },
    ],
  },
  {
    id: 'cat-drinks',
    name: 'Drinks',
    sortOrder: 2,
    items: [
      { id: 'menu-lime-soda', name: 'Lime Soda', price: 2500, prepStation: 'bar' as const, sku: 'DEMO-LIME-SODA' },
      { id: 'menu-milk-tea', name: 'Milk Tea', price: 2200, prepStation: 'bar' as const, sku: 'DEMO-MILK-TEA' },
    ],
  },
];

export async function ensureStarterRestaurantData(): Promise<void> {
  const branchId = getCurrentBranchId();
  const now = new Date().toISOString();

  for (const user of starterUsers) {
    if (await getUserRecordById(user.id)) continue;
    await saveUser({
      ...user,
      branchId,
      passwordHash: hashPassword(STARTER_PASSWORD),
      status: 'active',
    });
  }

  for (const table of starterTables) {
    if (await getTableById(table.id)) continue;
    await saveTable({
      ...table,
      branchId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const category of starterMenu) {
    if (!(await getCategoryById(category.id))) {
      await createCategory({
        id: category.id,
        branchId,
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const item of category.items) {
      if (!(await getItemById(item.id))) {
        await createItem({
          id: item.id,
          branchId,
          categoryId: category.id,
          name: item.name,
          price: item.price,
          prepStation: item.prepStation,
          taxMode: 'taxable',
          taxRate: 0,
          isAvailable: true,
          isActive: true,
          isPromotional: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      let inventoryItem = await getInventoryItemBySku(item.sku);
      if (!inventoryItem) {
        inventoryItem = await createInventoryMasterItem({
          branchId,
          sku: item.sku,
          name: `${item.name} stock`,
          unit: 'portion',
          minimumThreshold: 10,
          currentStock: 500,
        });
      } else {
        const balance = await getCurrentBalance(inventoryItem.id);
        if (balance < 100) {
          await appendStockMovement({
            branchId,
            itemId: inventoryItem.id,
            movementType: 'restock',
            quantityDelta: 500,
            reason: 'Starter POS stock top-up',
            idempotencyKey: `starter:${inventoryItem.id}:${Math.floor(Date.now() / 86_400_000)}`,
          });
        }
      }
      await saveMenuInventoryRecipe({ branchId, menuItemId: item.id, inventoryItemId: inventoryItem.id, quantityPerUnit: 1 });
    }
  }
}
