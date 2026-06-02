import { Actions, type Action } from '../../backend/auth/permissions';

export interface AppRoute {
  path: string;
  label: string;
  section: 'operations' | 'admin';
  requiredPermissions?: Action[];
  /**
   * Routes marked as superadmin_settings stay directly addressable, but are
   * launched from the Super admin panel instead of the global side/mobile nav.
   */
  navigationScope?: 'primary' | 'superadmin_settings';
  /** Hide a primary route from users with these permissions when a higher-level workspace already contains it. */
  hideFromPrimaryWhenPermissions?: Action[];
}

export const appRoutes: AppRoute[] = [
  { path: '#/dashboard', label: 'Dashboard', section: 'operations' },
  { path: '#/tables', label: 'Table floor', section: 'operations', requiredPermissions: [Actions.CreateOrder] },
  { path: '#/orders', label: 'Order', section: 'operations', requiredPermissions: [Actions.CreateOrder] },
  { path: '#/billing', label: 'Billing', section: 'operations', requiredPermissions: [Actions.ViewBill, Actions.CloseBill] },
  { path: '#/sales-history', label: 'Sales history', section: 'operations', requiredPermissions: [Actions.ViewSalesHistory] },
  { path: '#/kitchen', label: 'Kitchen KDS', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/bar', label: 'Bar KDS', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/prep-stations', label: 'Prep boards', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/waiter-progress', label: 'Waiter progress', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/menu-admin', label: 'Menu admin', section: 'admin', requiredPermissions: [Actions.ManageMenu] },
  { path: '#/table-admin', label: 'Table layout admin', section: 'admin', requiredPermissions: [Actions.ManageStaff] },
  { path: '#/inventory-alerts', label: 'Inventory alerts', section: 'admin', requiredPermissions: [Actions.AdjustStock] },
  { path: '#/reports', label: 'Reports', section: 'admin', requiredPermissions: [Actions.ViewReports] },
  { path: '#/audit', label: 'Audit', section: 'admin', requiredPermissions: [Actions.ViewAudit] },
  { path: '#/superadmin', label: 'Super admin panel', section: 'admin', requiredPermissions: [Actions.ManageSystem] },
  { path: '#/localization', label: 'Localization', section: 'admin', requiredPermissions: [Actions.ManageSystem], navigationScope: 'superadmin_settings' },
  { path: '#/bill-settings', label: 'Bill & printer settings', section: 'admin', requiredPermissions: [Actions.ManageSystem], navigationScope: 'superadmin_settings' },
  { path: '#/staff-settings', label: 'Staff & settings', section: 'admin', requiredPermissions: [Actions.ManageStaff], hideFromPrimaryWhenPermissions: [Actions.ManageSystem] },
];

export function canAccessRoute(route: AppRoute, permissions: Action[]): boolean {
  return !route.requiredPermissions?.length || route.requiredPermissions.some((permission) => permissions.includes(permission));
}

export function accessibleRoutes(permissions: Action[]): AppRoute[] {
  return appRoutes.filter((route) => canAccessRoute(route, permissions));
}

export function visibleRoutes(permissions: Action[]): AppRoute[] {
  return accessibleRoutes(permissions).filter((route) => {
    if (route.navigationScope === 'superadmin_settings') return false;
    return !route.hideFromPrimaryWhenPermissions?.some((permission) => permissions.includes(permission));
  });
}

export function superadminSettingsRoutes(permissions: Action[]): AppRoute[] {
  return accessibleRoutes(permissions).filter((route) => route.navigationScope === 'superadmin_settings');
}

export function defaultRoute(_permissions: Action[]): AppRoute {
  return appRoutes.find((route) => route.path === '#/dashboard') ?? appRoutes[0];
}
