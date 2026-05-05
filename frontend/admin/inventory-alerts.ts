import { InventoryAdminApi } from '../../backend/inventory/controller';

export interface AdminInventoryAlertsState {
  loading: boolean;
  error?: string;
  policy: Awaited<ReturnType<typeof InventoryAdminApi.getDeductionPolicy>>;
  alerts: Awaited<ReturnType<typeof InventoryAdminApi.listAlerts>>;
}

export async function loadAdminInventoryAlerts(): Promise<AdminInventoryAlertsState> {
  try {
    const [policy, alerts] = await Promise.all([InventoryAdminApi.getDeductionPolicy(), InventoryAdminApi.listAlerts()]);
    return { loading: false, policy, alerts };
  } catch (error) {
    return {
      loading: false,
      policy: 'on_in_preparation',
      alerts: [],
      error: error instanceof Error ? error.message : 'Failed to load inventory alerts.',
    };
  }
}
