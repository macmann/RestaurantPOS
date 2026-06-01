import { Actions, type Action } from '../../backend/auth/permissions';

export interface AppRoute {
  path: string;
  label: string;
  section: 'operations' | 'admin';
  requiredPermissions?: Action[];
}

export const appRoutes: AppRoute[] = [
  { path: '#/tables', label: 'Table floor', section: 'operations', requiredPermissions: [Actions.CreateOrder] },
  { path: '#/orders', label: 'Order', section: 'operations', requiredPermissions: [Actions.CreateOrder] },
  { path: '#/billing', label: 'Billing', section: 'operations', requiredPermissions: [Actions.ViewBill, Actions.CloseBill] },
  { path: '#/sales-history', label: 'Sales history', section: 'operations', requiredPermissions: [Actions.ViewSalesHistory] },
  { path: '#/kitchen', label: 'Kitchen KDS', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/bar', label: 'Bar KDS', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/waiter-progress', label: 'Waiter progress', section: 'operations', requiredPermissions: [Actions.TransitionOrderStatus] },
  { path: '#/menu-admin', label: 'Menu admin', section: 'admin', requiredPermissions: [Actions.ManageMenu] },
  { path: '#/table-admin', label: 'Table layout admin', section: 'admin', requiredPermissions: [Actions.ManageStaff] },
  { path: '#/inventory-alerts', label: 'Inventory alerts', section: 'admin', requiredPermissions: [Actions.AdjustStock] },
  { path: '#/reports', label: 'Reports', section: 'admin', requiredPermissions: [Actions.ViewReports] },
  { path: '#/audit', label: 'Audit', section: 'admin', requiredPermissions: [Actions.ViewAudit] },
  { path: '#/superadmin', label: 'Super admin panel', section: 'admin', requiredPermissions: [Actions.ManageSystem] },
  { path: '#/localization', label: 'Localization', section: 'admin', requiredPermissions: [Actions.ManageSystem] },
  { path: '#/bill-settings', label: 'Bill & printer settings', section: 'admin', requiredPermissions: [Actions.ManageSystem] },
  { path: '#/staff-settings', label: 'Staff & settings', section: 'admin', requiredPermissions: [Actions.ManageStaff] },
];

export function canAccessRoute(route: AppRoute, permissions: Action[]): boolean {
  return !route.requiredPermissions?.length || route.requiredPermissions.some((permission) => permissions.includes(permission));
}

export function visibleRoutes(permissions: Action[]): AppRoute[] {
  return appRoutes.filter((route) => canAccessRoute(route, permissions));
}

export function defaultRoute(permissions: Action[]): AppRoute {
  if (permissions.includes(Actions.ManageSystem)) return appRoutes.find((route) => route.path === '#/superadmin') ?? appRoutes[0];
  if (permissions.includes(Actions.CloseBill)) return appRoutes.find((route) => route.path === '#/billing') ?? visibleRoutes(permissions)[0] ?? appRoutes[0];
  if (permissions.includes(Actions.CreateOrder)) return appRoutes.find((route) => route.path === '#/orders') ?? visibleRoutes(permissions)[0] ?? appRoutes[0];
  return visibleRoutes(permissions)[0] ?? appRoutes[0];
}
