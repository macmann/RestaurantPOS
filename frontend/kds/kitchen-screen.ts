import type { AuthenticatedUser } from '../../backend/auth/policies';
import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';
import { apiClient } from '../api/client';
import type { KdsProgress } from '../../backend/kds/repository';

export async function loadKitchenQueue(locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    title: resource.screens.kitchen,
    localeSwitch: buildLocaleSwitchState(resource.locale),
    queue: await apiClient.getKdsSnapshot('kitchen', 'active'),
    history: await apiClient.getKdsSnapshot('kitchen', 'history'),
  };
}

export async function setKitchenItemProgress(user: AuthenticatedUser, orderId: string, orderItemId: string, progress: Extract<KdsProgress, 'preparing' | 'ready'>) {
  return apiClient.patchKdsItemProgress(user.id, orderId, orderItemId, progress);
}

export function subscribeKitchenQueue(onUpdate: Parameters<typeof apiClient.subscribeKds>[1]) {
  return apiClient.subscribeKds('kitchen', onUpdate, 'active');
}
