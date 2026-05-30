import type { AuthenticatedUser } from '../auth/policies';

const users = new Map<string, AuthenticatedUser>();

export async function getUserById(id: string): Promise<AuthenticatedUser | null> {
  const user = users.get(id);
  return user ? structuredClone(user) : null;
}

export async function saveUser(user: AuthenticatedUser): Promise<void> {
  users.set(user.id, structuredClone(user));
}

export async function listUsers(): Promise<AuthenticatedUser[]> {
  return [...users.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((user) => structuredClone(user));
}

export async function setUserStatus(id: string, status: 'active' | 'inactive'): Promise<AuthenticatedUser | null> {
  const user = users.get(id);
  if (!user) return null;

  const updated = { ...user, status };
  users.set(id, updated);
  return structuredClone(updated);
}
