declare const process: { exitCode?: number };
declare const global: any;

import { RestaurantApiClient } from '../frontend/api/client';
import type { KdsEvent } from '../backend/kds/service';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function testReconnectRetriesReads(): Promise<void> {
  global.window = {};
  const attempts: string[] = [];
  global.fetch = async (url: string) => {
    attempts.push(url);
    if (attempts.length < 3) throw new TypeError('LAN dropped');
    return jsonResponse({ data: [{ id: 'ord-reconnected' }] });
  };

  const client = new RestaurantApiClient('http://pos.local');
  const statuses: string[] = [];
  client.onNetworkStatus((status) => statuses.push(status));
  const orders = await client.listOrders();

  assert(Array.isArray(orders), 'Reconnect read should eventually resolve data.');
  assert(attempts.length === 3, `Expected read to retry until third attempt, saw ${attempts.length}.`);
  assert(statuses.includes('degraded'), 'Reconnect read should expose degraded state while retrying.');
  assert(statuses[statuses.length - 1] === 'online', 'Reconnect read should restore online state after success.');
}

async function testDuplicateSubmitPrevention(): Promise<void> {
  global.window = {};
  let resolveFetch: ((response: Response) => void) | undefined;
  let fetchCount = 0;
  let idempotencyKey = '';
  global.fetch = (async (_url: string, init: RequestInit) => {
    fetchCount += 1;
    idempotencyKey = String((init.headers as Record<string, string>)['idempotency-key'] ?? '');
    return new Promise<Response>((resolve) => { resolveFetch = resolve; });
  }) as typeof fetch;

  const client = new RestaurantApiClient('http://pos.local');
  const edit = { expectedVersion: 1, addItems: [{ menuItemId: 'tea', quantity: 1 }] };
  const first = client.editOrder('waiter-1', 'ord-1', edit);
  const second = client.editOrder('waiter-1', 'ord-1', edit);
  await Promise.resolve();

  assert(fetchCount === 1, `Expected concurrent duplicate edit submits to share one request, saw ${fetchCount}.`);
  assert(idempotencyKey.startsWith('pos:PATCH:'), 'Idempotent order edit should send an idempotency key.');
  resolveFetch?.(jsonResponse({ data: { id: 'ord-1', version: 2 } }));
  const [a, b] = await Promise.all([first, second]);
  assert(a === b, 'Concurrent duplicate submit promises should resolve to the same parsed result instance.');
}

async function testKdsReloadAfterDisconnect(): Promise<void> {
  global.window = {};
  let eventSource: { onmessage?: (event: MessageEvent) => void; onerror?: () => void; close: () => void } | undefined;
  global.EventSource = class {
    onmessage?: (event: MessageEvent) => void;
    onerror?: () => void;
    constructor(public readonly url: string) { eventSource = this; }
    close() {}
  };
  let snapshotFetches = 0;
  global.fetch = async (url: string) => {
    if (String(url).includes('/api/kds?station=kitchen')) {
      snapshotFetches += 1;
      return jsonResponse({ data: { at: 'now', groups: [{ station: 'kitchen', items: [{ orderId: 'ord-kds' }] }] } });
    }
    return jsonResponse({ data: {} });
  };

  const client = new RestaurantApiClient('http://pos.local');
  const events: KdsEvent[] = [];
  const unsubscribe = client.subscribeKds('kitchen', (event) => events.push(event));
  assert(eventSource, 'KDS subscription should create an EventSource.');
  eventSource!.onerror?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  unsubscribe();

  assert(snapshotFetches === 1, `Expected KDS disconnect to reload one snapshot, saw ${snapshotFetches}.`);
  assert(events.some((event) => event.type === 'snapshot'), 'KDS disconnect reload should emit a snapshot event.');
}

async function testUnsafePaymentRetryBlocked(): Promise<void> {
  global.window = {};
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    throw new TypeError('payment terminal timeout');
  };

  const client = new RestaurantApiClient('http://pos.local');
  let rejected = false;
  try {
    await client.recordSplitPayment({ tableSessionId: 'ts-1', splitLabel: 'A', amount: 10, method: 'card' }, 'cashier-1', 'pay-key-1');
  } catch {
    rejected = true;
  }

  assert(rejected, 'Unsafe payment write should reject when the first network attempt fails.');
  assert(attempts === 1, `Unsafe payment write must not retry automatically, saw ${attempts} attempts.`);
}

async function run(): Promise<void> {
  await testReconnectRetriesReads();
  await testDuplicateSubmitPrevention();
  await testKdsReloadAfterDisconnect();
  await testUnsafePaymentRetryBlocked();
  console.log('Reconnect browser behavior completed successfully.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
