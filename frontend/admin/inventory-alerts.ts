import { InventoryAdminApi } from '../../backend/inventory/controller';
import { getLocaleResource } from '../../backend/i18n/service';
import { buildLocaleSwitchState } from '../i18n/locale-switcher';

export interface AdminInventoryAlertsState {
  loading: boolean;
  error?: string;
  policy: Awaited<ReturnType<typeof InventoryAdminApi.getDeductionPolicy>>;
  alerts: Awaited<ReturnType<typeof InventoryAdminApi.listAlerts>>;
  title: string;
  localeSwitch: ReturnType<typeof buildLocaleSwitchState>;
}

export async function loadAdminInventoryAlerts(locale?: string): Promise<AdminInventoryAlertsState> {
  const resource = getLocaleResource(locale);
  try {
    const [policy, alerts] = await Promise.all([InventoryAdminApi.getDeductionPolicy(), InventoryAdminApi.listAlerts()]);
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
