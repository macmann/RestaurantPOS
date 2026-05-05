import type { AuthenticatedUser } from '../auth/policies';

const users = new Map<string, AuthenticatedUser>();

export async function getUserById(id: string): Promise<AuthenticatedUser | null> {
  return users.get(id) ?? null;
}

export async function saveUser(user: AuthenticatedUser): Promise<void> {
  users.set(user.id, user);
}

export async function setUserStatus(id: string, status: 'active' | 'inactive'): Promise<AuthenticatedUser | null> {
  const user = users.get(id);
  if (!user) return null;

  const updated = { ...user, status };
  users.set(id, updated);
  return updated;
}
