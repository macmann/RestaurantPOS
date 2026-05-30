import { recordAuditEvent } from '../audit/service';
import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import { getCurrentBranchId } from '../config/branch';
import { withTransaction } from '../db/client';
import { appendStockMovement, getDeductionTriggerPolicy } from '../inventory/service';
import { syncOrderIntoKds } from '../kds/service';
import { getCategoryById, getItemById, type MenuItemRecord } from '../menu/repository';
import { requireOpenTableSession } from '../tables/service';
import {
  createOrder,
  getOrderById,
  updateOrderWithVersionCheck,
  type OrderItem,
  type OrderRecord,
  type OrderStatus,
  type ServiceMode,
} from './repository';

export interface OrderMenuItemInput {
  menuItemId: string;
  quantity: number;
  note?: string;
  modifiers?: string[];
  allowUnavailableOverride?: boolean;
  overrideReason?: string;
}

export interface CreateOrderInput {
  branchId?: string;
  serviceMode: ServiceMode;
  tableId?: string;
  tableSessionId?: string;
  takeoutName?: string;
  items?: OrderMenuItemInput[];
}

export interface EditOrderInput {
  expectedVersion: number;
  addItems?: OrderMenuItemInput[];
  modifyItems?: Array<Pick<OrderItem, 'id'> & Partial<Pick<OrderItem, 'quantity' | 'note' | 'modifiers'>>>;
  removeItemIds?: string[];
  reason?: string;
}

export interface CancelOrderInput {
  expectedVersion: number;
  reason: string;
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

function assertBranchMatch(user: AuthenticatedUser, orderBranchId: string): void {
  if (user.branchId && user.branchId !== orderBranchId) {
    throw new Error(`Branch mismatch: user ${user.branchId} cannot access order branch ${orderBranchId}.`);
  }
}

function assertValidQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Item quantity must be greater than zero.');
}

function normalizeModifiers(modifiers: string[] | undefined): string[] | undefined {
  const normalized = (modifiers ?? []).map((modifier) => modifier.trim()).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function normalizeReason(reason: string | undefined, requiredMessage: string): string | undefined {
  const normalized = reason?.trim();
  if (!normalized && requiredMessage) throw new Error(requiredMessage);
  return normalized || undefined;
}

function assertAuthorizedUnavailableOverride(user: AuthenticatedUser, input: OrderMenuItemInput, unavailableReason: string): void {
  if (!input.allowUnavailableOverride) throw new Error(unavailableReason);
  if (!can(user, Actions.ManageMenu)) throw new Error('Forbidden: unavailable menu item override requires menu management permission.');
  if (!input.overrideReason?.trim()) throw new Error('Unavailable menu item override reason is required.');
}

async function buildOrderItemFromMenu(user: AuthenticatedUser, orderBranchId: string, input: OrderMenuItemInput): Promise<OrderItem> {
  assertValidQuantity(input.quantity);

  const menuItem = await getItemById(input.menuItemId);
  if (!menuItem) throw new Error(`Menu item ${input.menuItemId} not found.`);
  if (menuItem.branchId !== orderBranchId) throw new Error(`Branch mismatch: menu item ${menuItem.id} belongs to ${menuItem.branchId}, not ${orderBranchId}.`);

  const category = await getCategoryById(menuItem.categoryId);
  if (!category) throw new Error(`Menu category ${menuItem.categoryId} not found.`);
  if (category.branchId !== orderBranchId) throw new Error(`Branch mismatch: menu category ${category.id} belongs to ${category.branchId}, not ${orderBranchId}.`);

  if (!menuItem.isAvailable) assertAuthorizedUnavailableOverride(user, input, `Menu item ${menuItem.id} is unavailable.`);
  if (menuItem.isActive === false) assertAuthorizedUnavailableOverride(user, input, `Menu item ${menuItem.id} is inactive.`);
  if (!category.isActive) assertAuthorizedUnavailableOverride(user, input, `Menu category ${category.id} is inactive.`);

  return itemFromMenuRecord(menuItem, input);
}

function itemFromMenuRecord(menuItem: MenuItemRecord, input: OrderMenuItemInput): OrderItem {
  return {
    id: createId('ord_item'),
    menuItemId: menuItem.id,
    name: menuItem.name,
    station: menuItem.prepStation,
    quantity: input.quantity,
    unitPrice: menuItem.price,
    note: input.note,
    modifiers: normalizeModifiers(input.modifiers),
    taxMode: menuItem.taxMode ?? 'taxable',
    taxRate: menuItem.taxRate ?? 0,
    inventoryItemId: menuItem.inventoryItemId,
    lineTotal: calcLineTotal(input.quantity, menuItem.price),
  };
}

async function buildOrderItemsFromMenu(user: AuthenticatedUser, orderBranchId: string, inputs: OrderMenuItemInput[] | undefined): Promise<OrderItem[]> {
  const items: OrderItem[] = [];
  for (const input of inputs ?? []) {
    items.push(await buildOrderItemFromMenu(user, orderBranchId, input));
  }
  return items;
}

export async function createOrderDraft(user: AuthenticatedUser, input: CreateOrderInput): Promise<OrderRecord> {
  if (!can(user, Actions.CreateOrder)) throw new Error('Forbidden: cannot create order.');
  if (input.serviceMode === 'dine_in' && !input.tableSessionId) throw new Error('tableSessionId is required for dine-in orders.');
  if (input.serviceMode === 'takeout' && !input.takeoutName?.trim()) throw new Error('takeoutName is required for takeout orders.');

  const session = input.serviceMode === 'dine_in' ? await requireOpenTableSession(input.tableSessionId!) : undefined;
  const branchId = session?.branchId ?? input.branchId ?? user.branchId ?? getCurrentBranchId();
  assertBranchMatch(user, branchId);

  const now = new Date().toISOString();
  const items = await buildOrderItemsFromMenu(user, branchId, input.items);

  const order = await createOrder({
    id: createId('ord'),
    branchId,
    serviceMode: input.serviceMode,
    tableId: session?.tableId ?? input.tableId,
    tableSessionId: session?.id,
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

  await syncOrderIntoKds(order);
  return order;
}

export async function editOrderBeforePayment(user: AuthenticatedUser, orderId: string, input: EditOrderInput): Promise<OrderRecord> {
  assertCanEditOrder(user);
  const before = await getOrderById(orderId);
  if (!before) throw new Error('Order not found.');
  assertBranchMatch(user, before.branchId);
  const itemsToAdd = await buildOrderItemsFromMenu(user, before.branchId, input.addItems);

  const order = await updateOrderWithVersionCheck(orderId, input.expectedVersion, (draft) => {
    if (draft.status === 'delivered') throw new Error('Delivered orders cannot be modified.');

    for (const created of itemsToAdd) {
      draft.items.push(created);
      draft.changeLog.push({ at: new Date().toISOString(), actorUserId: user.id, actorRole: String(user.role), action: 'item_added', details: { itemId: created.id, menuItemId: created.menuItemId } });
    }

    for (const mod of input.modifyItems ?? []) {
      const target = draft.items.find((it) => it.id === mod.id);
      if (!target) throw new Error(`Order item ${mod.id} not found.`);
      if (typeof mod.quantity === 'number') {
        assertValidQuantity(mod.quantity);
        target.quantity = mod.quantity;
      }
      if (typeof mod.note === 'string') target.note = mod.note;
      if (Array.isArray(mod.modifiers)) target.modifiers = normalizeModifiers(mod.modifiers);
      target.lineTotal = calcLineTotal(target.quantity, target.unitPrice);
      draft.changeLog.push({ at: new Date().toISOString(), actorUserId: user.id, actorRole: String(user.role), action: 'item_modified', details: { itemId: target.id } });
    }

    if (input.removeItemIds?.length) {
      const removed = new Set(input.removeItemIds);
      draft.items = draft.items.filter((item) => {
        const shouldRemove = removed.has(item.id);
        if (shouldRemove) {
          draft.changeLog.push({ at: new Date().toISOString(), actorUserId: user.id, actorRole: String(user.role), action: 'item_removed', details: { itemId: item.id } });
        }
        return !shouldRemove;
      });
    }

    draft.subtotal = recalcSubtotal(draft.items);
    return draft;
  });

  await recordAuditEvent({
    action: 'order_edited',
    actor: user,
    entity: { type: 'order', id: order.id },
    before,
    after: order,
    reason: normalizeReason(input.reason, ''),
    metadata: {
      addedItems: input.addItems?.length ?? 0,
      modifiedItems: input.modifyItems?.length ?? 0,
      removedItems: input.removeItemIds?.length ?? 0,
    },
  });

  await syncOrderIntoKds(order);
  return order;
}

export async function cancelOrder(user: AuthenticatedUser, orderId: string, input: CancelOrderInput): Promise<OrderRecord> {
  assertCanEditOrder(user);
  const reason = normalizeReason(input.reason, 'A cancellation reason is required.');
  const before = await getOrderById(orderId);

  const order = await updateOrderWithVersionCheck(orderId, input.expectedVersion, (draft) => {
    if (draft.status === 'delivered') throw new Error('Delivered orders cannot be cancelled.');
    if (draft.status === 'cancelled') throw new Error('Order is already cancelled.');

    draft.changeLog.push({
      at: new Date().toISOString(),
      actorUserId: user.id,
      actorRole: String(user.role),
      action: 'order_cancelled',
      details: { from: draft.status, to: 'cancelled', reason },
    });
    draft.status = 'cancelled';
    return draft;
  });

  await recordAuditEvent({
    action: 'order_cancelled',
    actor: user,
    entity: { type: 'order', id: order.id },
    before,
    after: order,
    reason,
  });

  await syncOrderIntoKds(order);
  return order;
}

export async function transitionOrderStatus(user: AuthenticatedUser, orderId: string, expectedVersion: number, nextStatus: OrderStatus): Promise<OrderRecord> {
  if (!can(user, Actions.TransitionOrderStatus)) throw new Error('Forbidden: cannot transition order status.');

  return withTransaction(async () => {
    const order = await updateOrderWithVersionCheck(orderId, expectedVersion, (draft) => {
      assertBranchMatch(user, draft.branchId);
      const roles = Array.isArray(user.role) ? user.role : [user.role];
      const allowed = roles.some((role) => (ROLE_STATUS_FLOW[role] ?? []).some((path) => path.from === draft.status && path.to === nextStatus));
      if (!allowed) throw new Error(`Forbidden transition ${draft.status} -> ${nextStatus} for role(s): ${roles.join(', ')}.`);

      draft.changeLog.push({ at: new Date().toISOString(), actorUserId: user.id, actorRole: roles.join(','), action: 'status_transition', details: { from: draft.status, to: nextStatus } });
      draft.status = nextStatus;
      return draft;
    });

    if (nextStatus === 'in_preparation' && getDeductionTriggerPolicy() === 'on_in_preparation') {
      for (const item of order.items) {
        try {
          await appendStockMovement(
            {
              itemId: item.inventoryItemId ?? item.menuItemId,
              movementType: 'sale_deduction',
              quantityDelta: -Math.abs(item.quantity),
              reason: `Auto deduction for order ${order.id}`,
              referenceId: order.id,
            },
            user.id,
          );
        } catch {
          // Skip deduction if no inventory mapping exists for the order item.
        }
      }
    }

    await syncOrderIntoKds(order);
    return order;
  });
}

export async function getOrder(orderId: string) {
  return getOrderById(orderId);
}
