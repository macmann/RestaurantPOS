import { strict as assert } from 'node:assert';
import type { AuthenticatedUser } from '../backend/auth/policies';
import { createInventoryItem, upsertMenuInventoryRecipe } from '../backend/inventory/repository';
import { createCategory, createItem, updateCategory, updateItem } from '../backend/menu/repository';
import { createOrder } from '../backend/orders/repository';
import { getProductMixReport } from '../backend/reports/service';

async function run(): Promise<void> {
  process.env.POS_BRANCH_ID = 'product-mix-test';
  process.env.POS_BRANCH_TIMEZONE = 'America/New_York';
  const branchId = 'product-mix-test';
  const at = '2026-07-05T04:30:00.000Z'; // Sunday 00:30 in New York.
  await createCategory({ id: 'pm-cat', branchId, name: 'Original category', sortOrder: 1, isActive: true, createdAt: at, updatedAt: at });
  await createItem({ id: 'pm-item', branchId, categoryId: 'pm-cat', name: 'Original item', price: 12, prepStation: 'cold', isAvailable: true, isActive: true, isPromotional: true, createdAt: at, updatedAt: at });
  await createItem({ id: 'pm-no-recipe', branchId, categoryId: 'pm-cat', name: 'No recipe', price: 5, prepStation: 'cold', isAvailable: true, isActive: true, isPromotional: false, createdAt: at, updatedAt: at });
  await createInventoryItem({ id: 'pm-stock', branchId, sku: 'PM', name: 'Ingredient', unit: 'each', minimumThreshold: 0, unitCost: 2, createdAt: at, updatedAt: at });
  await upsertMenuInventoryRecipe({ id: 'pm-recipe', branchId, menuItemId: 'pm-item', inventoryItemId: 'pm-stock', quantityPerUnit: 1.5, createdAt: at, updatedAt: at });
  await createOrder({ id: 'pm-order', branchId, serviceMode: 'takeout', status: 'delivered', subtotal: 21, version: 1, createdBy: 'pm-waiter', createdAt: at, updatedAt: at, changeLog: [], items: [
    { id: 'pm-line', menuItemId: 'pm-item', name: 'Original item', categoryId: 'pm-cat', categoryName: 'Original category', station: 'cold', isPromotional: true, quantity: 2, unitPrice: 8, lineTotal: 16 },
    { id: 'pm-no-recipe-line', menuItemId: 'pm-no-recipe', name: 'No recipe', categoryId: 'pm-cat', categoryName: 'Original category', station: 'cold', quantity: 1, unitPrice: 5, lineTotal: 5 },
  ] });
  await updateItem('pm-item', { name: 'Renamed item', price: 99, prepStation: 'hot' });
  await updateCategory('pm-cat', { name: 'Renamed category' });

  const manager: AuthenticatedUser = { id: 'pm-manager', branchId, role: 'manager', status: 'active' };
  const report = await getProductMixReport(manager, { branchId, dateFrom: '2026-07-05T04:00:00.000Z', dateTo: '2026-07-05T05:00:00.000Z', intervalMinutes: 30 });
  const item = report.groups.menu_item.find((row) => row.key === 'pm-item')!;
  assert.equal(item.label, 'Original item', 'Menu renames must not rewrite historical item labels.');
  assert.equal(item.grossSales, 16, 'Promotional selling price must come from the order snapshot.');
  assert.equal(item.estimatedItemCost, 6);
  assert.equal(item.estimatedContributionMargin, 10);
  assert.equal(report.groups.category[0].label, 'Original category', 'Historical category snapshots must be retained.');
  assert.equal(report.groups.station[0].label, 'cold', 'Historical station snapshots must be retained.');
  assert.equal(report.groups.weekday[0].label, 'Sunday');
  assert.equal(report.groups.hour[0].label, '00:30–01:00', 'Hour intervals must use the configured branch timezone.');
  assert.deepEqual(report.summary.missingRecipeItemIds, ['pm-no-recipe']);
  assert.equal(report.groups.menu_item.find((row) => row.key === 'pm-no-recipe')?.costDataStatus, 'missing_recipe');
  console.log('Product mix unit tests completed successfully.');
}

void run();
