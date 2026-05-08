import { onKdsEvent } from '../../backend/kds/controller';
import { getLocaleResource } from '../../backend/i18n/service';
import { buildLocaleSwitchState } from '../i18n/locale-switcher';
import { getKdsSnapshot } from '../../backend/kds/service';

export async function loadOrderProgressForWaiter(locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    title: resource.screens.waiter_progress,
    localeSwitch: buildLocaleSwitchState(resource.locale),
    snapshot: await getKdsSnapshot(),
  };
}

export function subscribeOrderProgressForWaiter(onUpdate: Parameters<typeof onKdsEvent>[0]) {
  return onKdsEvent(onUpdate);
}
