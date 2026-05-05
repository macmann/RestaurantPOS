import type { AuthenticatedUser } from '../../backend/auth/policies';
import { listStationQueue, onKdsEvent, patchItemProgress } from '../../backend/kds/controller';
import type { KdsProgress } from '../../backend/kds/repository';

export async function loadBarQueue() {
  return listStationQueue('bar');
}

export async function setBarItemProgress(user: AuthenticatedUser, orderId: string, orderItemId: string, progress: Extract<KdsProgress, 'preparing' | 'ready'>) {
  return patchItemProgress(user, orderId, orderItemId, progress);
}

export function subscribeBarQueue(onUpdate: Parameters<typeof onKdsEvent>[0]) {
  return onKdsEvent(onUpdate);
}
