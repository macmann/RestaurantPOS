import { can, type AuthenticatedUser } from '../auth/policies';
import { listPrepStations } from '../config/posSettings';
import { Actions } from '../auth/permissions';
import type { OrderRecord, OrderStatus } from '../orders/repository';
import { appendKdsProgressHistory, getKdsItemState, listKdsItemStates, listKdsProgressHistory, type KdsItemState, type KdsProgress, type Station, upsertKdsItemState } from './repository';

export type KdsView = 'active' | 'history' | 'all';

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
    const station = stationForItem(item);
    if (!existing) {
      await recordProgress(order.branchId, order.id, item.id, station, 'queued', order.createdAt);
      const initialProgress = defaultProgress(order.status);
      if (initialProgress !== 'queued' && order.status !== 'cancelled') await recordProgress(order.branchId, order.id, item.id, station, initialProgress);
    }
    if (order.status === 'cancelled') {
      const history = await listKdsProgressHistory();
      if (!history.some((row) => row.orderItemId === item.id && row.orderId === order.id && row.progress === 'cancelled')) {
        await recordProgress(order.branchId, order.id, item.id, station, 'cancelled');
      }
    }
    await upsertKdsItemState({
      branchId: order.branchId,
      orderId: order.id,
      orderItemId: item.id,
      orderCreatedAt: order.createdAt,
      serviceMode: order.serviceMode,
      tableId: order.tableId,
      tableName: order.tableName,
      tableSessionId: order.tableSessionId,
      takeoutName: order.takeoutName,
      station,
      itemName: item.name,
      quantity: item.quantity,
      note: item.note,
      progress: existing?.progress ?? defaultProgress(order.status),
      updatedAt: new Date().toISOString(),
    });
  }

  emit({ type: 'snapshot', at: new Date().toISOString(), payload: await getKdsSnapshot() });
}

async function recordProgress(branchId: string, orderId: string, orderItemId: string, station: Station, progress: KdsProgress | 'cancelled', at = new Date().toISOString()): Promise<void> {
  await appendKdsProgressHistory({
    id: `${orderId}:${orderItemId}:${at}:${progress}:${Math.random().toString(36).slice(2)}`,
    branchId, orderId, orderItemId, station, progress, at,
  });
}

function matchesKdsView(row: KdsItemState, view: KdsView): boolean {
  if (view === 'all') return true;
  if (view === 'history') return row.progress === 'ready' || row.progress === 'served';
  return row.progress === 'queued' || row.progress === 'preparing';
}

export async function getKdsSnapshot(station?: Station, view: KdsView = 'all'): Promise<KdsSnapshot> {
  const nowMs = Date.now();
  const rows = await listKdsItemStates();
  const filtered = rows.filter((row) => (!station || row.station === station) && matchesKdsView(row, view));

  const stationIds = new Set(listPrepStations().map((row) => row.id));
  filtered.forEach((row) => stationIds.add(row.station));
  if (station) stationIds.add(station);

  const grouped: KdsTicketGroup[] = [...stationIds].map((groupStation) => ({
    station: groupStation,
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

  const at = new Date().toISOString();
  if (existing.progress !== progress) await recordProgress(existing.branchId, orderId, orderItemId, existing.station, progress, at);
  const updated = await upsertKdsItemState({ ...existing, progress, updatedAt: at });
  emit({ type: 'item_progress_updated', at: new Date().toISOString(), payload: updated });
  emit({ type: 'snapshot', at: new Date().toISOString(), payload: await getKdsSnapshot() });
  return updated;
}

export interface KdsPerformanceMetrics {
  ticketCount: number;
  averagePreparationSeconds: number;
  p50PreparationSeconds: number;
  p90PreparationSeconds: number;
  p95PreparationSeconds: number;
  longestWaitSeconds: number;
  activeBacklog: number;
  completedItems: number;
  cancellationsAfterPreparation: number;
  averageReadyToDeliveredSeconds: number;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(fraction * sorted.length) - 1] ?? 0);
}

export async function getKdsPerformanceMetrics(station: Station, dateFrom: string, dateTo: string, branchId?: string): Promise<KdsPerformanceMetrics> {
  const [states, allHistory] = await Promise.all([listKdsItemStates(), listKdsProgressHistory()]);
  const stationHistory = allHistory.filter((row) => row.station === station && (!branchId || row.branchId === branchId));
  const inRange = (at: string) => at >= dateFrom && at <= dateTo;
  const byItem = new Map<string, typeof stationHistory>();
  stationHistory.forEach((row) => { const key = `${row.orderId}:${row.orderItemId}`; byItem.set(key, [...(byItem.get(key) ?? []), row]); });
  const preparation: number[] = [];
  const delivery: number[] = [];
  let completedItems = 0;
  let cancellationsAfterPreparation = 0;
  for (const events of byItem.values()) {
    const preparing = events.find((event) => event.progress === 'preparing') ?? events.find((event) => event.progress === 'queued');
    const ready = events.find((event) => event.progress === 'ready' && inRange(event.at));
    const served = events.find((event) => event.progress === 'served' && inRange(event.at));
    if (preparing && ready) preparation.push(Math.max(0, (Date.parse(ready.at) - Date.parse(preparing.at)) / 1000));
    if (ready) completedItems += states.find((state) => state.orderId === ready.orderId && state.orderItemId === ready.orderItemId)?.quantity ?? 1;
    if (ready && served) delivery.push(Math.max(0, (Date.parse(served.at) - Date.parse(ready.at)) / 1000));
    if (events.some((event) => event.progress === 'cancelled' && inRange(event.at)) && events.some((event) => event.progress === 'preparing' || event.progress === 'ready')) cancellationsAfterPreparation += 1;
  }
  const now = Date.now();
  const cancelledKeys = new Set(allHistory.filter((row) => row.progress === 'cancelled').map((row) => `${row.orderId}:${row.orderItemId}`));
  const active = states.filter((row) => row.station === station && (!branchId || row.branchId === branchId) && !cancelledKeys.has(`${row.orderId}:${row.orderItemId}`) && (row.progress === 'queued' || row.progress === 'preparing') && row.orderCreatedAt <= dateTo);
  const activeWaits = active.map((row) => Math.max(0, (now - Date.parse(row.orderCreatedAt)) / 1000));
  return {
    ticketCount: new Set(stationHistory.filter((row) => row.progress === 'queued' && inRange(row.at)).map((row) => row.orderId)).size,
    averagePreparationSeconds: preparation.length ? Math.round(preparation.reduce((a, b) => a + b, 0) / preparation.length) : 0,
    p50PreparationSeconds: percentile(preparation, .5), p90PreparationSeconds: percentile(preparation, .9), p95PreparationSeconds: percentile(preparation, .95),
    longestWaitSeconds: Math.round(Math.max(0, ...preparation, ...activeWaits)),
    activeBacklog: active.reduce((sum, row) => sum + row.quantity, 0), completedItems,
    cancellationsAfterPreparation,
    averageReadyToDeliveredSeconds: delivery.length ? Math.round(delivery.reduce((a, b) => a + b, 0) / delivery.length) : 0,
  };
}

export function subscribeKds(listener: (event: KdsEvent) => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}
