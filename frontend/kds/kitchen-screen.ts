import type { AuthenticatedUser } from '../../backend/auth/policies';
import { listStationQueue, onKdsEvent, patchItemProgress } from '../../backend/kds/controller';
import type { KdsProgress } from '../../backend/kds/repository';

export async function loadKitchenQueue() {
  return listStationQueue('kitchen');
}

export async function setKitchenItemProgress(user: AuthenticatedUser, orderId: string, orderItemId: string, progress: Extract<KdsProgress, 'preparing' | 'ready'>) {
  return patchItemProgress(user, orderId, orderItemId, progress);
}

export function subscribeKitchenQueue(onUpdate: Parameters<typeof onKdsEvent>[0]) {
  return onKdsEvent(onUpdate);
}
