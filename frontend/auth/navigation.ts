import { Actions, type Action } from '../../backend/auth/permissions';

export interface AppRoute {
  path: string;
  label: string;
  section: 'operations' | 'admin';
  requiredPermissions?: Action[];
}

export const appRoutes: AppRoute[] = [
  { path: '#/orders', label: 'Cashier order entry', section: 'operations', requiredPermissions: [Actions.CreateOrder] },
  { path: '#/billing', label: 'Billing', section: 'operations', requiredPermissions: [Actions.CloseBill] },
  { path: '#/kitchen', label: 'Kitchen KDS', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/bar', label: 'Bar KDS', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/waiter-progress', label: 'Waiter progress', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/menu-admin', label: 'Menu admin', section: 'admin', requiredPermissions: [Actions.ManageMenu] },
  { path: '#/inventory-alerts', label: 'Inventory alerts', section: 'admin', requiredPermissions: [Actions.AdjustStock] },
  { path: '#/reports', label: 'Reports', section: 'admin', requiredPermissions: [Actions.ViewReports] },
  { path: '#/audit', label: 'Audit', section: 'admin', requiredPermissions: [Actions.ViewAudit] },
  { path: '#/staff-settings', label: 'Staff & settings', section: 'admin', requiredPermissions: [Actions.ViewAudit] },
];

export function canAccessRoute(route: AppRoute, permissions: Action[]): boolean {
  return !route.requiredPermissions?.length || route.requiredPermissions.some((permission) => permissions.includes(permission));
}

export function visibleRoutes(permissions: Action[]): AppRoute[] {
  return appRoutes.filter((route) => canAccessRoute(route, permissions));
}

export function defaultRoute(permissions: Action[]): AppRoute {
  return visibleRoutes(permissions)[0] ?? appRoutes[0];
}
