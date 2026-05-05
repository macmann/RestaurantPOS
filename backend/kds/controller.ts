import type { AuthenticatedUser } from '../auth/policies';
import { getKdsSnapshot, subscribeKds, updateKdsItemProgress } from './service';
import type { KdsProgress, Station } from './repository';

export async function listStationQueue(station?: Station) {
  return getKdsSnapshot(station);
}

export async function patchItemProgress(user: AuthenticatedUser, orderId: string, orderItemId: string, progress: KdsProgress) {
  return updateKdsItemProgress(user, orderId, orderItemId, progress);
}

export function onKdsEvent(listener: Parameters<typeof subscribeKds>[0]) {
  return subscribeKds(listener);
}
