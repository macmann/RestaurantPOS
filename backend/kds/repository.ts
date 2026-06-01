import { isSqlRepositoryEnabled } from '../db/client';
import { getRecord, listRecords, putRecord } from '../db/repositoryStore';

export type Station = string;
export type KdsProgress = 'queued' | 'preparing' | 'ready' | 'served';

export interface KdsItemState {
  branchId: string;
  orderId: string;
  orderItemId: string;
  orderCreatedAt: string;
  station: Station;
  itemName: string;
  quantity: number;
  note?: string;
  progress: KdsProgress;
  updatedAt: string;
}

const itemStates = new Map<string, KdsItemState>();

function key(orderId: string, orderItemId: string): string {
  return `${orderId}:${orderItemId}`;
}

export async function upsertKdsItemState(next: KdsItemState): Promise<KdsItemState> {
  if (isSqlRepositoryEnabled()) return putRecord('kds:items', key(next.orderId, next.orderItemId), next);
  itemStates.set(key(next.orderId, next.orderItemId), structuredClone(next));
  return structuredClone(next);
}

export async function listKdsItemStates(): Promise<KdsItemState[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<KdsItemState>('kds:items') : Array.from(itemStates.values());
  return rows.map((item) => structuredClone(item));
}

export async function getKdsItemState(orderId: string, orderItemId: string): Promise<KdsItemState | null> {
  if (isSqlRepositoryEnabled()) return getRecord<KdsItemState>('kds:items', key(orderId, orderItemId));
  const row = itemStates.get(key(orderId, orderItemId));
  return row ? structuredClone(row) : null;
}
