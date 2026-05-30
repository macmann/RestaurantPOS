import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';
import { apiClient } from '../api/client';

export interface AdminInventoryAlertsState {
  loading: boolean;
  error?: string;
  policy: Awaited<ReturnType<typeof apiClient.getInventoryDeductionPolicy>>;
  alerts: Awaited<ReturnType<typeof apiClient.getInventoryAlerts>>;
  title: string;
  localeSwitch: ReturnType<typeof buildLocaleSwitchState>;
}

export async function loadAdminInventoryAlerts(locale?: string): Promise<AdminInventoryAlertsState> {
  const resource = getLocaleResource(locale);
  try {
    const [policy, alerts] = await Promise.all([apiClient.getInventoryDeductionPolicy(), apiClient.getInventoryAlerts()]);
    return { loading: false, policy, alerts, title: resource.screens.inventory_alerts, localeSwitch: buildLocaleSwitchState(resource.locale) };
  } catch (error) {
    return {
      loading: false,
      policy: 'on_in_preparation',
      alerts: [],
      title: resource.screens.inventory_alerts,
      localeSwitch: buildLocaleSwitchState(resource.locale),
      error: error instanceof Error ? error.message : 'Failed to load inventory alerts.',
    };
  }
}
