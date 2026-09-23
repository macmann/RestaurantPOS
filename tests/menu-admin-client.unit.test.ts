declare const process: { exitCode?: number };

import { MenuAdminClient, type DeploymentMode, type RequestOptions } from '../frontend/api/client';
import { assert } from './helpers/assertions';

interface Call { path: string; options?: RequestOptions }

async function verifyMode(mode: DeploymentMode, root: string): Promise<void> {
  const calls: Call[] = [];
  const transport = { async request(path: string, options?: RequestOptions): Promise<any> { calls.push({ path, options }); return []; } };
  const menu = new MenuAdminClient(transport, async () => mode);
  await menu.list();
  await menu.createCategory({ name: 'Lunch', sortOrder: 1 });
  await menu.updateCategory('cat/a', { name: 'Dinner' });
  await menu.deleteCategory('cat/a');
  await menu.createItem({ categoryId: 'cat', name: 'Rice', price: 4 });
  await menu.updateItem('item/a', { price: 5 });
  await menu.setAvailability('item/a', false);
  await menu.setPromotional('item/a', true);
  await menu.deleteItem('item/a');
  const expected = [root, `${root}/categories`, `${root}/categories/cat%2Fa`, `${root}/categories/cat%2Fa`, `${root}/items`, `${root}/items/item%2Fa`, `${root}/items/item%2Fa/availability`, `${root}/items/item%2Fa/promotional`, `${root}/items/item%2Fa`];
  assert(JSON.stringify(calls.map((call) => call.path)) === JSON.stringify(expected), `${mode} should use only the ${root} route family.`);
  assert(calls[1].options?.method === 'POST' && calls[4].options?.method === 'POST', `${mode} creates should use POST.`);
  assert(calls[2].options?.method === 'PATCH' && calls[5].options?.method === 'PATCH', `${mode} updates should use PATCH.`);
  assert(calls[3].options?.method === 'DELETE' && calls[8].options?.method === 'DELETE', `${mode} deletes should use DELETE.`);
}

async function run(): Promise<void> {
  await verifyMode('POS', '/api/menu');
  await verifyMode('CLOUD', '/manager-api/menu');
  console.log('menu admin client unit tests passed');
}

void run().catch((error) => { console.error(error); process.exitCode = 1; });
