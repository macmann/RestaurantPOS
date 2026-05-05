export type Station = 'kitchen' | 'bar';
export type KdsProgress = 'queued' | 'preparing' | 'ready' | 'served';

export interface KdsItemState {
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
  itemStates.set(key(next.orderId, next.orderItemId), structuredClone(next));
  return structuredClone(next);
}

export async function listKdsItemStates(): Promise<KdsItemState[]> {
  return Array.from(itemStates.values()).map((item) => structuredClone(item));
}

export async function getKdsItemState(orderId: string, orderItemId: string): Promise<KdsItemState | null> {
  const row = itemStates.get(key(orderId, orderItemId));
  return row ? structuredClone(row) : null;
}
