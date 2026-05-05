import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import type { OrderRecord, OrderStatus } from '../orders/repository';
import { getKdsItemState, listKdsItemStates, type KdsItemState, type KdsProgress, type Station, upsertKdsItemState } from './repository';

export interface KdsTicketItem extends KdsItemState {
  elapsedSeconds: number;
}

export interface KdsTicketGroup {
  station: Station;
  items: KdsTicketItem[];
}

export interface KdsSnapshot {
  at: string;
  groups: KdsTicketGroup[];
}

export interface KdsEvent {
  type: 'snapshot' | 'item_progress_updated';
  at: string;
  payload: KdsSnapshot | KdsItemState;
}

const subscribers = new Set<(event: KdsEvent) => void>();

function emit(event: KdsEvent): void {
  for (const sub of subscribers) sub(event);
}

function stationForItem(item: { station?: Station; menuItemId: string; name: string }): Station {
  if (item.station) return item.station;
  const classifier = `${item.menuItemId} ${item.name}`.toLowerCase();
  return classifier.includes('bar') || classifier.includes('drink') || classifier.includes('cocktail') ? 'bar' : 'kitchen';
}

function defaultProgress(orderStatus: OrderStatus): KdsProgress {
  if (orderStatus === 'pending') return 'queued';
  if (orderStatus === 'in_preparation') return 'preparing';
  if (orderStatus === 'completed') return 'ready';
  return 'served';
}

export async function syncOrderIntoKds(order: OrderRecord): Promise<void> {
  for (const item of order.items) {
    const existing = await getKdsItemState(order.id, item.id);
    await upsertKdsItemState({
      orderId: order.id,
      orderItemId: item.id,
      orderCreatedAt: order.createdAt,
      station: stationForItem(item),
      itemName: item.name,
      quantity: item.quantity,
      note: item.note,
      progress: existing?.progress ?? defaultProgress(order.status),
      updatedAt: new Date().toISOString(),
    });
  }

  emit({ type: 'snapshot', at: new Date().toISOString(), payload: await getKdsSnapshot() });
}

export async function getKdsSnapshot(station?: Station): Promise<KdsSnapshot> {
  const nowMs = Date.now();
  const rows = await listKdsItemStates();
  const filtered = station ? rows.filter((row) => row.station === station) : rows;

  const grouped: KdsTicketGroup[] = ['kitchen', 'bar'].map((groupStation) => ({
    station: groupStation as Station,
    items: filtered
      .filter((row) => row.station === groupStation)
      .sort((a, b) => a.orderCreatedAt.localeCompare(b.orderCreatedAt))
      .map((row) => ({ ...row, elapsedSeconds: Math.max(0, Math.floor((nowMs - new Date(row.orderCreatedAt).getTime()) / 1000)) })),
  }));

  return { at: new Date().toISOString(), groups: station ? grouped.filter((g) => g.station === station) : grouped };
}

export async function updateKdsItemProgress(
  user: AuthenticatedUser,
  orderId: string,
  orderItemId: string,
  progress: KdsProgress,
): Promise<KdsItemState> {
  if (!can(user, Actions.TransitionOrderStatus)) throw new Error('Forbidden: cannot update prep progress.');

  const existing = await getKdsItemState(orderId, orderItemId);
  if (!existing) throw new Error('KDS item not found.');

  const updated = await upsertKdsItemState({ ...existing, progress, updatedAt: new Date().toISOString() });
  emit({ type: 'item_progress_updated', at: new Date().toISOString(), payload: updated });
  emit({ type: 'snapshot', at: new Date().toISOString(), payload: await getKdsSnapshot() });
  return updated;
}

export function subscribeKds(listener: (event: KdsEvent) => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}
