import { AdminMenuApi } from '../../backend/menu/controller';

export interface AdminMenuDashboardState {
  loading: boolean;
  error?: string;
  categories: Awaited<ReturnType<typeof AdminMenuApi.list>>;
}

export async function loadAdminMenuDashboard(): Promise<AdminMenuDashboardState> {
  try {
    const categories = await AdminMenuApi.list();
    return { loading: false, categories };
  } catch (error) {
    return {
      loading: false,
      categories: [],
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
