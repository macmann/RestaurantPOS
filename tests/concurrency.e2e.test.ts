declare const process: { exitCode?: number };

import { createInventoryMasterItem, listInventoryWithBalances, saveMenuInventoryRecipe } from '../backend/inventory/service';
import { adminCreateCategory, adminCreateItem } from '../backend/menu/service';
import { createTable } from '../backend/tables/service';
import type { TableOrderItem } from '../backend/billing/repository';
import { assert, assertEqual } from './helpers/assertions';
import { apiRequest, login, seedLoginUser, startTestServer } from './helpers/apiTestHarness';

async function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; reason: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (reason) {
    return { ok: false, reason };
  }
}

async function runConcurrencyCoverage(): Promise<void> {
  const branchId = 'concurrency-main';
  const password = 'correct-horse-concurrency';
  await Promise.all([
    seedLoginUser({ id: 'manager-conc', username: 'manager-conc', branchId, role: 'manager', status: 'active', password }),
    seedLoginUser({ id: 'waiter-conc', username: 'waiter-conc', branchId, role: 'waitstaff', status: 'active', password }),
    seedLoginUser({ id: 'kitchen-conc', username: 'kitchen-conc', branchId, role: 'kitchen', status: 'active', password }),
    seedLoginUser({ id: 'cashier-conc', username: 'cashier-conc', branchId, role: 'cashier', status: 'active', password }),
  ]);

  const rice = await createInventoryMasterItem({ branchId, sku: 'RICE-CONC', name: 'Concurrency Rice', unit: 'portion', minimumThreshold: 1, currentStock: 5 });
  const category = await adminCreateCategory({ branchId, name: 'Concurrency Specials', sortOrder: 1 });
  const menuItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Concurrency Tea Rice', price: 12, prepStation: 'kitchen', isAvailable: true });
  await saveMenuInventoryRecipe({ branchId, menuItemId: menuItem.id, inventoryItemId: rice.id, quantityPerUnit: 1 });

  const server = await startTestServer();
  try {
    const waiter = await login(server.baseUrl, 'waiter-conc', password);
    const cashier = await login(server.baseUrl, 'cashier-conc', password);

    const sessionTable = await createTable({ id: 'CONC-T1', branchId, name: 'Concurrency Table 1', capacity: 4 });
    const openAttempts = await Promise.all([
      apiRequest(server.baseUrl, `/api/tables/${sessionTable.id}/sessions`, { method: 'POST', token: cashier.token, body: { guestCount: 2, branchId } }),
      apiRequest(server.baseUrl, `/api/tables/${sessionTable.id}/sessions`, { method: 'POST', token: cashier.token, body: { guestCount: 2, branchId } }),
    ]);
    assertEqual(openAttempts.filter((response) => response.status === 201).length, 1, 'Exactly one simultaneous table-session open should succeed.');
    assertEqual(openAttempts.filter((response) => response.status === 409).length, 1, 'Exactly one simultaneous table-session open should conflict.');

    const orderTable = await createTable({ id: 'CONC-T2', branchId, name: 'Concurrency Table 2', capacity: 4 });
    const sessionResponse = await apiRequest<{ data: { id: string } }>(server.baseUrl, `/api/tables/${orderTable.id}/sessions`, {
      method: 'POST',
      token: cashier.token,
      body: { guestCount: 2, branchId },
    });
    assert(sessionResponse.status === 201, 'Order table session should open.');
    const tableSessionId = sessionResponse.body.data.id;

    const orderResponse = await apiRequest<{ data: { id: string; version: number; items: TableOrderItem[] } }>(server.baseUrl, '/api/orders', {
      method: 'POST',
      token: waiter.token,
      body: { branchId, serviceMode: 'dine_in', tableSessionId, items: [{ menuItemId: menuItem.id, quantity: 2 }] },
    });
    assert(orderResponse.status === 201, 'Concurrency order should be created.');
    const order = orderResponse.body.data;

    const staleVersionAttempts = await Promise.all([
      apiRequest(server.baseUrl, `/api/orders/${order.id}/status`, { method: 'POST', token: waiter.token, body: { expectedVersion: order.version, nextStatus: 'in_preparation' } }),
      apiRequest(server.baseUrl, `/api/orders/${order.id}/status`, { method: 'POST', token: waiter.token, body: { expectedVersion: order.version, nextStatus: 'in_preparation' } }),
    ]);
    assertEqual(staleVersionAttempts.filter((response) => response.status === 200).length, 1, 'Exactly one stale-version status transition should succeed.');
    assertEqual(staleVersionAttempts.filter((response) => response.status === 409).length, 1, 'Exactly one stale-version status transition should conflict.');

    const balances = await listInventoryWithBalances();
    assertEqual(balances.find((item) => item.id === rice.id)?.currentBalance, 3, 'Concurrent transitions should deduct stock only once.');

    const billLines: TableOrderItem[] = order.items.map((item) => ({ ...item, orderId: order.id, tableSessionId }));
    const billResponse = await apiRequest<{ data: { calculationBreakdown: { totalDue: number }; splits: { A: { payments: unknown[] } } } }>(server.baseUrl, '/api/billing/bills', {
      method: 'POST',
      token: cashier.token,
      body: { tableSessionId, itemsBySplit: { A: billLines }, pricing: { taxMode: 'tax_exempt' }, branchId },
    });
    assert(billResponse.status === 201, 'Bill should be created for duplicate-payment coverage.');

    const paymentBody = { splitLabel: 'A', amount: billResponse.body.data.calculationBreakdown.totalDue, method: 'cash' };
    const duplicatePayments = await Promise.all([
      apiRequest<{ data: { splits: { A: { payments: unknown[] } } } }>(server.baseUrl, `/api/billing/bills/${tableSessionId}/payments`, {
        method: 'POST',
        token: cashier.token,
        headers: { 'idempotency-key': 'duplicate-payment-concurrency' },
        body: paymentBody,
      }),
      apiRequest<{ data: { splits: { A: { payments: unknown[] } } } }>(server.baseUrl, `/api/billing/bills/${tableSessionId}/payments`, {
        method: 'POST',
        token: cashier.token,
        headers: { 'idempotency-key': 'duplicate-payment-concurrency' },
        body: paymentBody,
      }),
    ]);
    assert(duplicatePayments.every((response) => response.status === 200), 'Duplicate idempotent payments should both receive successful responses.');
    assert(duplicatePayments.some((response) => response.headers.get('x-idempotency-replayed') === 'true'), 'One duplicate payment response should be replayed from idempotency storage.');
    assertEqual(duplicatePayments[1].body.data.splits.A.payments.length, 1, 'Duplicate payment submissions should persist one payment.');

    const mismatch = await apiRequest(server.baseUrl, `/api/billing/bills/${tableSessionId}/payments`, {
      method: 'POST',
      token: cashier.token,
      headers: { 'idempotency-key': 'duplicate-payment-concurrency' },
      body: { ...paymentBody, amount: paymentBody.amount + 1 },
    });
    assertEqual(mismatch.status, 409, 'Reusing an idempotency key for a different payment should conflict.');
  } finally {
    await server.close();
  }
}

void settle(runConcurrencyCoverage()).then((result) => {
  if (!result.ok) {
    console.error(result.reason);
    process.exitCode = 1;
    return;
  }
  console.log('Concurrency E2E coverage completed successfully.');
});
