import { Action, RolePermissions, UserStatus } from './permissions';

export interface AuthenticatedUser {
  id: string;
  role: string | string[];
  status: UserStatus;
}

export function isUserActive(user: AuthenticatedUser | null | undefined): boolean {
  return !!user && user.status === 'active';
}

export function hasPermission(user: AuthenticatedUser, action: Action): boolean {
  const roles = Array.isArray(user.role) ? user.role : [user.role];
  return roles.some((role) => (RolePermissions[role] ?? []).includes(action));
}

export function can(user: AuthenticatedUser | null | undefined, action: Action): boolean {
  if (!isUserActive(user)) return false;
  return hasPermission(user, action);
}
