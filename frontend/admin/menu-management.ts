import { AdminMenuApi } from '../../backend/menu/controller';
import { getLocaleResource } from '../../backend/i18n/service';
import { buildLocaleSwitchState } from '../i18n/locale-switcher';

export interface AdminMenuDashboardState {
  loading: boolean;
  error?: string;
  categories: Awaited<ReturnType<typeof AdminMenuApi.list>>;
  title: string;
  localeSwitch: ReturnType<typeof buildLocaleSwitchState>;
}

export async function loadAdminMenuDashboard(locale?: string): Promise<AdminMenuDashboardState> {
  const resource = getLocaleResource(locale);
  try {
    const categories = await AdminMenuApi.list();
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
  await AdminMenuApi.createCategory({ name: 'Beers', sortOrder: 1 });
  await AdminMenuApi.createCategory({ name: 'Alcohol', sortOrder: 2 });
  await AdminMenuApi.createCategory({ name: 'Chinese Menu', sortOrder: 3 });
  await AdminMenuApi.createCategory({ name: 'BBQ', sortOrder: 4 });
  await AdminMenuApi.createCategory({ name: 'Salads', sortOrder: 5 });
}
