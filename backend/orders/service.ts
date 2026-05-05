import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import {
  createOrder,
  getOrderById,
  updateOrderWithVersionCheck,
  type OrderItem,
  type OrderRecord,
  type OrderStatus,
  type ServiceMode,
} from './repository';

export interface CreateOrderInput {
  serviceMode: ServiceMode;
  tableId?: string;
  takeoutName?: string;
  items?: Array<Pick<OrderItem, 'menuItemId' | 'name' | 'quantity' | 'unitPrice' | 'note'>>;
}

export interface EditOrderInput {
  expectedVersion: number;
  addItems?: Array<Pick<OrderItem, 'menuItemId' | 'name' | 'quantity' | 'unitPrice' | 'note'>>;
  modifyItems?: Array<Pick<OrderItem, 'id'> & Partial<Pick<OrderItem, 'quantity' | 'note' | 'unitPrice'>>>;
  removeItemIds?: string[];
}

const ROLE_STATUS_FLOW: Record<string, Array<{ from: OrderStatus; to: OrderStatus }>> = {
  waitstaff: [
    { from: 'pending', to: 'in_preparation' },
    { from: 'completed', to: 'delivered' },
  ],
  kitchen: [{ from: 'in_preparation', to: 'completed' }],
  bar: [{ from: 'in_preparation', to: 'completed' }],
};

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function calcLineTotal(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice * 100) / 100;
}

function recalcSubtotal(items: OrderItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;
}

function assertCanEditOrder(user: AuthenticatedUser): void {
  if (!can(user, Actions.EditOrder)) throw new Error('Forbidden: cannot edit order.');
}

export async function createOrderDraft(user: AuthenticatedUser, input: CreateOrderInput): Promise<OrderRecord> {
  if (!can(user, Actions.CreateOrder)) throw new Error('Forbidden: cannot create order.');
  if (input.serviceMode === 'dine_in' && !input.tableId) throw new Error('tableId is required for dine-in orders.');
  if (input.serviceMode === 'takeout' && !input.takeoutName?.trim()) throw new Error('takeoutName is required for takeout orders.');

  const now = new Date().toISOString();
  const items: OrderItem[] = (input.items ?? []).map((item) => ({
    id: createId('ord_item'),
    menuItemId: item.menuItemId,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    note: item.note,
    lineTotal: calcLineTotal(item.quantity, item.unitPrice),
  }));

  return createOrder({
    id: createId('ord'),
    serviceMode: input.serviceMode,
    tableId: input.tableId,
    takeoutName: input.takeoutName?.trim(),
    status: 'pending',
    items,
    subtotal: recalcSubtotal(items),
    version: 1,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    changeLog: [],
  });
}

export async function editOrderBeforePayment(user: AuthenticatedUser, orderId: string, input: EditOrderInput): Promise<OrderRecord> {
  assertCanEditOrder(user);

  return updateOrderWithVersionCheck(orderId, input.expectedVersion, (order) => {
    if (order.status === 'delivered') throw new Error('Delivered orders cannot be modified.');

    for (const item of input.addItems ?? []) {
      const created: OrderItem = {
        id: createId('ord_item'),
        menuItemId: item.menuItemId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        note: item.note,
        lineTotal: calcLineTotal(item.quantity, item.unitPrice),
      };
      order.items.push(created);
      order.changeLog.push({ at: new Date().toISOString(), actorUserId: user.id, actorRole: String(user.role), action: 'item_added', details: { itemId: created.id } });
    }

    for (const mod of input.modifyItems ?? []) {
      const target = order.items.find((it) => it.id === mod.id);
      if (!target) throw new Error(`Order item ${mod.id} not found.`);
      if (typeof mod.quantity === 'number') target.quantity = mod.quantity;
      if (typeof mod.unitPrice === 'number') target.unitPrice = mod.unitPrice;
      if (typeof mod.note === 'string') target.note = mod.note;
      target.lineTotal = calcLineTotal(target.quantity, target.unitPrice);
      order.changeLog.push({ at: new Date().toISOString(), actorUserId: user.id, actorRole: String(user.role), action: 'item_modified', details: { itemId: target.id } });
    }

    if (input.removeItemIds?.length) {
      const removed = new Set(input.removeItemIds);
      order.items = order.items.filter((item) => {
        const shouldRemove = removed.has(item.id);
        if (shouldRemove) {
          order.changeLog.push({ at: new Date().toISOString(), actorUserId: user.id, actorRole: String(user.role), action: 'item_removed', details: { itemId: item.id } });
        }
        return !shouldRemove;
      });
    }

    order.subtotal = recalcSubtotal(order.items);
    return order;
  });
}

export async function transitionOrderStatus(
  user: AuthenticatedUser,
  orderId: string,
  expectedVersion: number,
  nextStatus: OrderStatus,
): Promise<OrderRecord> {
  return updateOrderWithVersionCheck(orderId, expectedVersion, (order) => {
    const roles = Array.isArray(user.role) ? user.role : [user.role];
    const allowed = roles.some((role) => (ROLE_STATUS_FLOW[role] ?? []).some((path) => path.from === order.status && path.to === nextStatus));
    if (!allowed) throw new Error(`Forbidden transition ${order.status} -> ${nextStatus} for role(s): ${roles.join(', ')}.`);

    order.changeLog.push({ at: new Date().toISOString(), actorUserId: user.id, actorRole: roles.join(','), action: 'status_transition', details: { from: order.status, to: nextStatus } });
    order.status = nextStatus;
    return order;
  });
}

export async function getOrder(orderId: string) {
  return getOrderById(orderId);
}
