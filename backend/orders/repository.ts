export type ServiceMode = 'dine_in' | 'takeout';
export type OrderStatus = 'pending' | 'in_preparation' | 'completed' | 'delivered' | 'cancelled';

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  station?: 'kitchen' | 'bar';
  quantity: number;
  unitPrice: number;
  note?: string;
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
  orders.set(order.id, structuredClone(order));
  return structuredClone(order);
}

export async function listOrders(): Promise<OrderRecord[]> {
  return [...orders.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((order) => structuredClone(order));
}

export async function getOrderById(orderId: string): Promise<OrderRecord | null> {
  const order = orders.get(orderId);
  return order ? structuredClone(order) : null;
}

export async function updateOrderWithVersionCheck(
  orderId: string,
  expectedVersion: number,
  mutate: (order: OrderRecord) => OrderRecord,
): Promise<OrderRecord> {
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
