declare const process: { exitCode?: number };

import { createInventoryMasterItem, saveMenuInventoryRecipe } from '../backend/inventory/service';
import { adminCreateCategory, adminCreateItem } from '../backend/menu/service';
import { createTable } from '../backend/tables/service';
import type { TableOrderItem } from '../backend/billing/repository';
import { assert } from './helpers/assertions';
import { apiRequest, login, seedLoginUser, startTestServer } from './helpers/apiTestHarness';

async function runApiIntegration(): Promise<void> {
  const branchId = 'api-main';
  const password = 'correct-horse-api';
  await Promise.all([
    seedLoginUser({ id: 'manager-api', username: 'manager-api', branchId, role: 'manager', status: 'active', password }),
    seedLoginUser({ id: 'waiter-api', username: 'waiter-api', branchId, role: 'waitstaff', status: 'active', password }),
    seedLoginUser({ id: 'kitchen-api', username: 'kitchen-api', branchId, role: 'kitchen', status: 'active', password }),
    seedLoginUser({ id: 'cashier-api', username: 'cashier-api', branchId, role: 'cashier', status: 'active', password }),
  ]);

  const rice = await createInventoryMasterItem({ branchId, sku: 'RICE-API', name: 'API Rice', unit: 'portion', minimumThreshold: 1, currentStock: 10 });
  const category = await adminCreateCategory({ branchId, name: 'API Specials', sortOrder: 1 });
  const menuItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'API Tea Rice', price: 11, prepStation: 'kitchen', isAvailable: true });
  await saveMenuInventoryRecipe({ branchId, menuItemId: menuItem.id, inventoryItemId: rice.id, quantityPerUnit: 1 });
  const table = await createTable({ id: 'API-T1', branchId, name: 'API Table 1', capacity: 4 });

  const server = await startTestServer();
  try {
    const manager = await login(server.baseUrl, 'manager-api', password);
    const waiter = await login(server.baseUrl, 'waiter-api', password);
    const kitchen = await login(server.baseUrl, 'kitchen-api', password);
    const cashier = await login(server.baseUrl, 'cashier-api', password);
    assert(manager.permissions.includes('menu:manage'), 'Manager login should return real RBAC permissions.');

    const floor = await apiRequest<{ data: Array<{ table: { id: string }; status: string }> }>(server.baseUrl, `/api/tables?branchId=${branchId}`, { token: cashier.token });
    assert(floor.status === 200, `Cashier table floor should load over HTTP, got ${floor.status}.`);
    assert(floor.body.data.some((row) => row.table.id === table.id && row.status === 'available'), 'Cashier table floor should include the seeded table.');

    const sessionResponse = await apiRequest<{ data: { id: string } }>(server.baseUrl, `/api/tables/${table.id}/sessions`, {
      method: 'POST',
      token: cashier.token,
      body: { guestCount: 2, branchId },
    });
    assert(sessionResponse.status === 201, `Opening a table session should return 201, got ${sessionResponse.status}.`);
    const tableSessionId = sessionResponse.body.data.id;

    const orderResponse = await apiRequest<{ data: { id: string; version: number; items: TableOrderItem[] } }>(server.baseUrl, '/api/orders', {
      method: 'POST',
      token: waiter.token,
      body: { branchId, serviceMode: 'dine_in', tableSessionId, items: [{ menuItemId: menuItem.id, quantity: 2 }] },
    });
    assert(orderResponse.status === 201, `Creating an order should return 201, got ${orderResponse.status}.`);
    const order = orderResponse.body.data;

    const statusResponse = await apiRequest<{ data: { version: number } }>(server.baseUrl, `/api/orders/${order.id}/status`, {
      method: 'POST',
      token: waiter.token,
      body: { expectedVersion: order.version, nextStatus: 'in_preparation' },
    });
    assert(statusResponse.status === 200, `Transitioning an order should return 200, got ${statusResponse.status}.`);

    const kds = await apiRequest<{ data: { groups: Array<{ station: string; items: Array<{ orderId: string }> }> } }>(server.baseUrl, '/api/kds?station=kitchen', { token: kitchen.token });
    assert(kds.status === 200, `Kitchen KDS should load over HTTP, got ${kds.status}.`);
    assert(kds.body.data.groups.some((group) => group.items.some((item) => item.orderId === order.id)), 'Kitchen KDS should include the in-preparation order.');

    const billLines: TableOrderItem[] = order.items.map((item) => ({ ...item, orderId: order.id, tableSessionId }));
    const bill = await apiRequest<{ data: { calculationBreakdown: { totalDue: number } } }>(server.baseUrl, '/api/billing/bills', {
      method: 'POST',
      token: cashier.token,
      body: { tableSessionId, itemsBySplit: { A: billLines }, pricing: { taxMode: 'tax_exempt' }, branchId },
    });
    assert(bill.status === 201, `Creating a bill should return 201, got ${bill.status}.`);

    const payment = await apiRequest(server.baseUrl, `/api/billing/bills/${tableSessionId}/payments`, {
      method: 'POST',
      token: cashier.token,
      headers: { 'idempotency-key': 'api-payment-1' },
      body: { splitLabel: 'A', amount: bill.body.data.calculationBreakdown.totalDue, method: 'cash' },
    });
    assert(payment.status === 200, `Recording a real-auth payment should return 200, got ${payment.status}.`);

    const audit = await apiRequest<{ data: { events: Array<{ action: string }> } }>(server.baseUrl, '/api/audit/events?query=cash_drawer_opened&limit=20', { token: manager.token });
    assert(audit.status === 200, `Admin audit search should return 200, got ${audit.status}.`);
    assert(audit.body.data.events.some((event) => event.action === 'cash_drawer_opened'), 'Admin audit should expose the cash drawer payment event.');
  } finally {
    await server.close();
  }
}

runApiIntegration()
  .then(() => console.log('API server integration flow completed successfully.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
