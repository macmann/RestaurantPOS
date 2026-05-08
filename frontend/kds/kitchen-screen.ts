import type { AuthenticatedUser } from '../../backend/auth/policies';
import { listStationQueue, onKdsEvent, patchItemProgress } from '../../backend/kds/controller';
import { getLocaleResource } from '../../backend/i18n/service';
import { buildLocaleSwitchState } from '../i18n/locale-switcher';
import type { KdsProgress } from '../../backend/kds/repository';

export async function loadKitchenQueue(locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    title: resource.screens.kitchen,
    localeSwitch: buildLocaleSwitchState(resource.locale),
    queue: await listStationQueue('kitchen'),
  };
}

export async function setKitchenItemProgress(user: AuthenticatedUser, orderId: string, orderItemId: string, progress: Extract<KdsProgress, 'preparing' | 'ready'>) {
  return patchItemProgress(user, orderId, orderItemId, progress);
}

export function subscribeKitchenQueue(onUpdate: Parameters<typeof onKdsEvent>[0]) {
  return onKdsEvent(onUpdate);
}
