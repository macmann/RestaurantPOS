import { isSqlRepositoryEnabled, query, withTransaction } from '../db/client';
import { ensureRepositoryStore, getRecord, listRecords, putRecord } from '../db/repositoryStore';

export type ServiceMode = 'dine_in' | 'takeout';
export type OrderStatus = 'pending' | 'in_preparation' | 'completed' | 'delivered' | 'cancelled';

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  station?: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  modifiers?: string[];
  taxMode?: 'taxable' | 'tax_exempt';
  taxRate?: number;
  inventoryItemId?: string;
  lineTotal: number;
}

export interface OrderChangeEntry {
  at: string;
  actorUserId: string;
  actorRole: string;
  action: 'item_added' | 'item_modified' | 'item_removed' | 'status_transition' | 'order_cancelled';
  details: Record<string, unknown>;
}

export interface OrderRecord {
  id: string;
  branchId: string;
  serviceMode: ServiceMode;
  tableId?: string;
  tableSessionId?: string;
  takeoutName?: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  changeLog: OrderChangeEntry[];
}

const orders = new Map<string, OrderRecord>();

export async function createOrder(order: OrderRecord): Promise<OrderRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('orders', order.id, order);
  orders.set(order.id, structuredClone(order));
  return structuredClone(order);
}

export async function listOrders(): Promise<OrderRecord[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<OrderRecord>('orders') : [...orders.values()].map((order) => structuredClone(order));
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getOrderById(orderId: string): Promise<OrderRecord | null> {
  if (isSqlRepositoryEnabled()) return getRecord<OrderRecord>('orders', orderId);
  const order = orders.get(orderId);
  return order ? structuredClone(order) : null;
}

export async function updateOrderWithVersionCheck(
  orderId: string,
  expectedVersion: number,
  mutate: (order: OrderRecord) => OrderRecord,
): Promise<OrderRecord> {
  if (isSqlRepositoryEnabled()) {
    return withTransaction(async () => {
      await ensureRepositoryStore();
      const locked = await query<{ payload: OrderRecord }>(
        'SELECT payload FROM repository_records WHERE namespace = $1 AND record_key = $2 FOR UPDATE',
        ['orders', orderId],
      );
      const current = locked.rows[0]?.payload;
      if (!current) throw new Error('Order not found.');
      if (current.version !== expectedVersion) {
        throw new Error(`Version conflict detected. Expected ${expectedVersion}, actual ${current.version}.`);
      }

      const next = mutate(structuredClone(current));
      next.version = current.version + 1;
      next.updatedAt = new Date().toISOString();
      return putRecord('orders', orderId, next);
    });
  }

  const current = orders.get(orderId);
  if (!current) throw new Error('Order not found.');
  if (current.version !== expectedVersion) {
    throw new Error(`Version conflict detected. Expected ${expectedVersion}, actual ${current.version}.`);
  }

  const next = mutate(structuredClone(current));
  next.version = current.version + 1;
  next.updatedAt = new Date().toISOString();

  orders.set(orderId, structuredClone(next));
  return structuredClone(next);
}
