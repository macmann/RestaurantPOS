import { createHash, randomBytes } from 'crypto';
import { isSqlRepositoryEnabled } from '../db/client';
import { getRecord, listRecords, putRecord } from '../db/repositoryStore';

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt?: string;
  revokedReason?: string;
}

const sessions = new Map<string, AuthSessionRecord>();

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionIdForToken(token: string): string {
  return hashSessionToken(token).slice(0, 32);
}

export async function saveSession(session: AuthSessionRecord): Promise<AuthSessionRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('auth:sessions', session.id, session);
  sessions.set(session.id, structuredClone(session));
  return structuredClone(session);
}

export async function getSessionById(id: string): Promise<AuthSessionRecord | null> {
  if (isSqlRepositoryEnabled()) return getRecord<AuthSessionRecord>('auth:sessions', id);
  const session = sessions.get(id);
  return session ? structuredClone(session) : null;
}

export async function getSessionByToken(token: string): Promise<AuthSessionRecord | null> {
  const session = await getSessionById(sessionIdForToken(token));
  if (!session || session.tokenHash !== hashSessionToken(token)) return null;
  return session;
}

export async function touchSession(id: string, at = new Date().toISOString()): Promise<AuthSessionRecord | null> {
  const session = await getSessionById(id);
  if (!session || session.revokedAt) return session;
  return saveSession({ ...session, lastSeenAt: at });
}

export async function revokeSession(id: string, reason = 'logout', at = new Date().toISOString()): Promise<AuthSessionRecord | null> {
  const session = await getSessionById(id);
  if (!session) return null;
  const revoked = { ...session, revokedAt: session.revokedAt ?? at, revokedReason: session.revokedReason ?? reason };
  return saveSession(revoked);
}

export async function revokeUserSessions(userId: string, reason = 'user_status_changed', at = new Date().toISOString()): Promise<number> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<AuthSessionRecord>('auth:sessions') : [...sessions.values()].map((session) => structuredClone(session));
  const active = rows.filter((session) => session.userId === userId && !session.revokedAt);
  await Promise.all(active.map((session) => saveSession({ ...session, revokedAt: at, revokedReason: reason })));
  return active.length;
}
