import type { AuthenticatedUser } from '../../backend/auth/policies';
import type { TableFloorState } from '../../backend/tables/service';
import { apiClient } from '../api/client';
import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';

export interface CashierTableFloorViewModel {
  title: string;
  localeSwitch: ReturnType<typeof buildLocaleSwitchState>;
  tables: TableFloorState[];
  counts: {
    available: number;
    occupied: number;
    inactive: number;
  };
}

export async function loadCashierTableFloor(branchId?: string, locale?: string): Promise<CashierTableFloorViewModel> {
  const resource = getLocaleResource(locale);
  const tables = await apiClient.listTableFloor(branchId);
  return {
    title: 'Table floor',
    localeSwitch: buildLocaleSwitchState(resource.locale),
    tables,
    counts: {
      available: tables.filter((row) => row.status === 'available').length,
      occupied: tables.filter((row) => row.status === 'occupied').length,
      inactive: tables.filter((row) => row.status === 'inactive').length,
    },
  };
}

export async function openCashierTableSession(user: AuthenticatedUser, tableId: string, guestCount: number, branchId?: string) {
  return apiClient.openTableSession(user.id, tableId, guestCount, branchId);
}

export async function closeCashierTableSession(user: AuthenticatedUser, tableSessionId: string) {
  return apiClient.closeTableSession(user.id, tableSessionId);
}
