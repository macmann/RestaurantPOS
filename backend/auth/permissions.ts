export type UserStatus = 'active' | 'inactive';

export const Actions = {
  CreateOrder: 'orders:create',
  EditOrder: 'orders:edit',
  AdjustStock: 'stock:adjust',
  MarkDebt: 'billing:mark_debt',
  CloseBill: 'billing:close',
  ViewReports: 'reports:view',
} as const;

export type Action = (typeof Actions)[keyof typeof Actions];

export const RolePermissions: Record<string, Action[]> = {
  cashier: [Actions.CreateOrder, Actions.EditOrder, Actions.MarkDebt, Actions.CloseBill],
  shift_lead: [
    Actions.CreateOrder,
    Actions.EditOrder,
    Actions.AdjustStock,
    Actions.MarkDebt,
    Actions.CloseBill,
  ],
  inventory_clerk: [Actions.AdjustStock],
  manager: [
    Actions.CreateOrder,
    Actions.EditOrder,
    Actions.AdjustStock,
    Actions.MarkDebt,
    Actions.CloseBill,
    Actions.ViewReports,
  ],
  admin: [
    Actions.CreateOrder,
    Actions.EditOrder,
    Actions.AdjustStock,
    Actions.MarkDebt,
    Actions.CloseBill,
    Actions.ViewReports,
  ],
};
