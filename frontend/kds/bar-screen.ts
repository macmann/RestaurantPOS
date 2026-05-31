import type { AuthenticatedUser } from '../../backend/auth/policies';
import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';
import { apiClient } from '../api/client';
import type { KdsProgress } from '../../backend/kds/repository';

export async function loadBarQueue(locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    title: resource.screens.bar,
    localeSwitch: buildLocaleSwitchState(resource.locale),
    queue: await apiClient.getKdsSnapshot('bar', 'active'),
    history: await apiClient.getKdsSnapshot('bar', 'history'),
  };
}

export async function setBarItemProgress(user: AuthenticatedUser, orderId: string, orderItemId: string, progress: Extract<KdsProgress, 'preparing' | 'ready'>) {
  return apiClient.patchKdsItemProgress(user.id, orderId, orderItemId, progress);
}

export function subscribeBarQueue(onUpdate: Parameters<typeof apiClient.subscribeKds>[1]) {
  return apiClient.subscribeKds('bar', onUpdate, 'active');
}
