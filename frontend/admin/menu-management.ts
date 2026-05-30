import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';
import { apiClient } from '../api/client';

export interface AdminMenuDashboardState {
  loading: boolean;
  error?: string;
  categories: Awaited<ReturnType<typeof apiClient.listMenu>>;
  title: string;
  localeSwitch: ReturnType<typeof buildLocaleSwitchState>;
}

export async function loadAdminMenuDashboard(locale?: string): Promise<AdminMenuDashboardState> {
  const resource = getLocaleResource(locale);
  try {
    const categories = await apiClient.listMenu();
    return { loading: false, categories, title: resource.screens.admin_menu, localeSwitch: buildLocaleSwitchState(resource.locale) };
  } catch (error) {
    return {
      loading: false,
      categories: [],
      title: resource.screens.admin_menu,
      localeSwitch: buildLocaleSwitchState(resource.locale),
      error: error instanceof Error ? error.message : 'Failed to load menu dashboard.',
    };
  }
}

export async function createStarterCategories() {
  await apiClient.createMenuCategory({ name: 'Beers', sortOrder: 1 });
  await apiClient.createMenuCategory({ name: 'Alcohol', sortOrder: 2 });
  await apiClient.createMenuCategory({ name: 'Chinese Menu', sortOrder: 3 });
  await apiClient.createMenuCategory({ name: 'BBQ', sortOrder: 4 });
  await apiClient.createMenuCategory({ name: 'Salads', sortOrder: 5 });
}
