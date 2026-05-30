import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';
import { apiClient } from '../api/client';

export async function loadOrderProgressForWaiter(locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    title: resource.screens.waiter_progress,
    localeSwitch: buildLocaleSwitchState(resource.locale),
    snapshot: await apiClient.getKdsSnapshot(),
  };
}

export function subscribeOrderProgressForWaiter(onUpdate: Parameters<typeof apiClient.subscribeKds>[1]) {
  return apiClient.subscribeKds(undefined, onUpdate);
}
