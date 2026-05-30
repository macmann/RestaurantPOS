import type { AuthenticatedUser } from '../auth/policies';
import { isSqlRepositoryEnabled } from '../db/client';
import { getRecord, listRecords, putRecord } from '../db/repositoryStore';

const users = new Map<string, AuthenticatedUser>();

export async function getUserById(id: string): Promise<AuthenticatedUser | null> {
  if (isSqlRepositoryEnabled()) return getRecord<AuthenticatedUser>('users', id);
  const user = users.get(id);
  return user ? structuredClone(user) : null;
}

export async function saveUser(user: AuthenticatedUser): Promise<void> {
  if (isSqlRepositoryEnabled()) {
    await putRecord('users', user.id, user);
    return;
  }
  users.set(user.id, structuredClone(user));
}

export async function listUsers(): Promise<AuthenticatedUser[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<AuthenticatedUser>('users') : [...users.values()].map((user) => structuredClone(user));
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export async function setUserStatus(id: string, status: 'active' | 'inactive'): Promise<AuthenticatedUser | null> {
  const user = isSqlRepositoryEnabled() ? await getRecord<AuthenticatedUser>('users', id) : users.get(id);
  if (!user) return null;

  const updated = { ...user, status };
  if (isSqlRepositoryEnabled()) return putRecord('users', id, updated);
  users.set(id, updated);
  return structuredClone(updated);
}
