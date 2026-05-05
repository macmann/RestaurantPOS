export type UserStatus = 'active' | 'inactive';

export const Actions = {
  CreateOrder: 'orders:create',
  EditOrder: 'orders:edit',
  AdjustStock: 'stock:adjust',
  MarkDebt: 'billing:mark_debt',
  CloseBill: 'billing:close',
  ViewReports: 'reports:view',
  ManageMenu: 'menu:manage',
  TransitionOrderStatus: 'orders:transition_status',
} as const;

export type Action = (typeof Actions)[keyof typeof Actions];

export const RolePermissions: Record<string, Action[]> = {
  cashier: [Actions.CreateOrder, Actions.EditOrder, Actions.MarkDebt, Actions.CloseBill],
  waitstaff: [Actions.CreateOrder, Actions.EditOrder, Actions.TransitionOrderStatus],
  kitchen: [Actions.TransitionOrderStatus],
  bar: [Actions.TransitionOrderStatus],
  shift_lead: [
    Actions.CreateOrder,
    Actions.EditOrder,
    Actions.AdjustStock,
    Actions.MarkDebt,
    Actions.CloseBill,
    Actions.TransitionOrderStatus,
  ],
  inventory_clerk: [Actions.AdjustStock],
  manager: [
    Actions.CreateOrder,
    Actions.EditOrder,
    Actions.AdjustStock,
    Actions.MarkDebt,
    Actions.CloseBill,
    Actions.ViewReports,
    Actions.ManageMenu,
    Actions.TransitionOrderStatus,
  ],
  admin: [
    Actions.CreateOrder,
    Actions.EditOrder,
    Actions.AdjustStock,
    Actions.MarkDebt,
    Actions.CloseBill,
    Actions.ViewReports,
    Actions.ManageMenu,
    Actions.TransitionOrderStatus,
  ],
};
