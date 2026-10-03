declare const process: { exitCode?: number };
import { getCurrentBranchId } from '../backend/config/branch';
import { getPosOperationalSettings } from '../backend/config/posSettings';
import { parseBulkUploadWorkbook } from '../backend/menu/bulkImport/parser';
import { confirmBulkImport, previewBulkImport } from '../backend/menu/bulkImport/service';
import { validateBulkUploadRows } from '../backend/menu/bulkImport/validator';
import { getCategoryByName, getItemByNameInCategory } from '../backend/menu/repository';
import { adminCreateCategory, adminCreateItem } from '../backend/menu/service';
import { createOrderDraft } from '../backend/orders/service';
import { getOrderPrinterAdapter, resetOrderPrinterAdapter } from '../backend/hardware/orderPrinter';
import type { AuthenticatedUser } from '../backend/auth/policies';
import { createXlsxFixture } from './helpers/xlsx';
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function rejects(action: () => unknown, text: string): void { try { action(); } catch (error) { assert(String(error).includes(text), `Expected '${text}', got ${String(error)}`); return; } throw new Error(`Expected '${text}' rejection.`); }
async function run(): Promise<void> {
  const columns = ['Name', 'Category', 'Station', 'Price'];
  const parsed = parseBulkUploadWorkbook(createXlsxFixture([columns, [' ထမင်းကြော် (ကြက်) ', ' မြန်မာ ', ' Kitchen ', 8000], ['', '', '', ''], ['Lime Soda', 'Drinks', 'Bar', '2500'], ['Bad', 'Food', 'Kitchen', 'ABC']]));
  assert(parsed.rows.length === 3, 'Blank rows should be ignored.'); const validated = validateBulkUploadRows(parsed);
  assert(validated.rows[0].name === 'ထမင်းကြော် (ကြက်)', 'Burmese Unicode and punctuation should be preserved while trimming.');
  assert(validated.rows[0].price === 8000 && validated.rows[1].price === 2500, 'Numeric and numeric-string prices should be accepted.');
  assert(validated.errors[0]?.field === 'Price' && validated.errors[0]?.rowNumber === 5, 'Invalid price should include row and field.');
  rejects(() => parseBulkUploadWorkbook(createXlsxFixture([columns], 'Menu')), "Worksheet 'Bulk Upload' was not found");
  for (const missing of columns) rejects(() => parseBulkUploadWorkbook(createXlsxFixture([columns.filter((column) => column !== missing)])), `Required column '${missing}' was not found`);
  const branchId = getCurrentBranchId(); const user: AuthenticatedUser = { id: 'bulk-import-manager', branchId, role: 'manager', status: 'active' };
  const existingCategory = await adminCreateCategory({ branchId, name: 'Bulk Existing', sortOrder: 900 }); await adminCreateItem({ branchId, categoryId: existingCategory.id, name: 'Update Me', price: 1, prepStation: 'kitchen' });
  const importFile = createXlsxFixture([columns, ['Update Me', 'Bulk Existing', 'Salad', 10], ['Same Name', 'Bulk Existing', 'bbq', 20], ['Same Name', 'Bulk Other', 'bbq', 30], ['ကြက်ကင်', 'အကင်', 'Kitchen', 10000]]);
  const preview = await previewBulkImport(user, 'menu.xlsx', importFile); assert(preview.token && preview.items.create === 3 && preview.items.update === 1, 'Preview should distinguish creates and updates without writing.');
  assert(!await getCategoryByName('Bulk Other', branchId), 'Preview must not create categories.'); assert(!getPosOperationalSettings().prepStations.some((station) => station.id === 'salad'), 'Preview must not create stations.');
  const result = await confirmBulkImport(user, preview.token); assert(result.categoriesCreated === 2 && result.stationsCreated === 2 && result.itemsCreated === 3 && result.itemsUpdated === 1, 'Import should create dependencies and mutate items.');
  const updated = await getItemByNameInCategory(existingCategory.id, 'Update Me'); assert(updated?.price === 10 && updated.prepStation === 'salad', 'Existing same-category item should update price and station.');
  const other = await getCategoryByName('Bulk Other', branchId); assert(other && await getItemByNameInCategory(other.id, 'Same Name'), 'Same name in a different category should remain separate.');
  const bbqItem = other && await getItemByNameInCategory(other.id, 'Same Name'); assert(bbqItem, 'Imported bbq item should exist.');
  resetOrderPrinterAdapter(); const order = await createOrderDraft(user, { branchId, serviceMode: 'takeout', takeoutName: 'Bulk print', items: [{ menuItemId: bbqItem.id, quantity: 1 }] });
  const tickets = await getOrderPrinterAdapter().printOrderForConfiguredStations(order); const bbqTicket = tickets.find((ticket) => ticket.station === 'bbq');
  assert(bbqTicket?.renderedText.includes('1 x Same Name'), 'Dynamic station ticket should contain the exact imported item name.');
  const second = await previewBulkImport(user, 'menu.xlsx', importFile); assert(second.items.unchanged === 4 && second.items.create === 0 && second.items.update === 0, 'Uploading an identical file should be unchanged.');
  const secondResult = await confirmBulkImport(user, second.token!); assert(secondResult.unchanged === 4 && secondResult.itemsUpdated === 0, 'Unchanged items should not be written.');
  console.log('menu bulk import unit tests passed');
}
void run().catch((error) => { console.error(error); process.exitCode = 1; });
