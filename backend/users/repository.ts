import type { AuthenticatedUser } from '../auth/policies';
import { isSqlRepositoryEnabled } from '../db/client';
import { getRecord, listRecords, putRecord } from '../db/repositoryStore';

export type StaffRole = string | string[];

export interface UserRecord extends AuthenticatedUser {
  username: string;
  email?: string;
  passwordHash?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type PublicUserProfile = Omit<UserRecord, 'passwordHash'>;

const users = new Map<string, UserRecord>();

function normalizeUser(user: AuthenticatedUser | UserRecord): UserRecord {
  const username = ('username' in user && user.username?.trim()) || user.id;
  return {
    ...user,
    username,
    email: ('email' in user && user.email?.trim()) || undefined,
    passwordHash: 'passwordHash' in user ? user.passwordHash : undefined,
  };
}

export function toPublicUser(user: AuthenticatedUser | UserRecord): PublicUserProfile {
  const normalized = normalizeUser(user);
  const { passwordHash: _passwordHash, ...safe } = normalized;
  return structuredClone(safe);
}

export async function getUserById(id: string): Promise<PublicUserProfile | null> {
  const user = isSqlRepositoryEnabled() ? await getRecord<UserRecord>('users', id) : users.get(id);
  return user ? toPublicUser(user) : null;
}

export async function getUserRecordById(id: string): Promise<UserRecord | null> {
  const user = isSqlRepositoryEnabled() ? await getRecord<UserRecord>('users', id) : users.get(id);
  return user ? structuredClone(normalizeUser(user)) : null;
}

export async function getUserRecordByLogin(identifier: string): Promise<UserRecord | null> {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  if (!normalizedIdentifier) return null;
  const rows = isSqlRepositoryEnabled() ? await listRecords<UserRecord>('users') : [...users.values()].map((user) => structuredClone(user));
  const match = rows.find((user) => {
    const normalized = normalizeUser(user);
    return [normalized.id, normalized.username, normalized.email]
      .filter(Boolean)
      .some((value) => value!.toLowerCase() === normalizedIdentifier);
  });
  return match ? structuredClone(normalizeUser(match)) : null;
}

export async function saveUser(user: AuthenticatedUser | UserRecord): Promise<PublicUserProfile> {
  const existing = await getUserRecordById(user.id);
  const now = new Date().toISOString();
  const normalized = normalizeUser({
    ...existing,
    ...user,
    createdAt: existing?.createdAt ?? ('createdAt' in user ? user.createdAt : undefined) ?? now,
    updatedAt: now,
  } as UserRecord);

  if (isSqlRepositoryEnabled()) {
    await putRecord('users', normalized.id, normalized);
    return toPublicUser(normalized);
  }
  users.set(normalized.id, structuredClone(normalized));
  return toPublicUser(normalized);
}

export async function listUsers(): Promise<PublicUserProfile[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<UserRecord>('users') : [...users.values()].map((user) => structuredClone(user));
  return rows.map(toPublicUser).sort((a, b) => a.id.localeCompare(b.id));
}

export async function setUserStatus(id: string, status: 'active' | 'inactive'): Promise<PublicUserProfile | null> {
  const user = await getUserRecordById(id);
  if (!user) return null;

  return saveUser({ ...user, status });
}
