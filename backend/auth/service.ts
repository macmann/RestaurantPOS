import { timingSafeEqual, randomBytes, pbkdf2Sync } from 'crypto';
import { recordAuditEvent } from '../audit/service';
import { getUserById, getUserRecordByLogin, toPublicUser } from '../users/repository';
import { isUserActive, type AuthenticatedUser } from './policies';
import {
  createSessionToken,
  getSessionByToken,
  hashSessionToken,
  revokeSession,
  saveSession,
  sessionIdForToken,
  touchSession,
  type AuthSessionRecord,
} from './sessionRepository';

const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface LoginResult {
  user: AuthenticatedUser;
  token: string;
  expiresAt: string;
}

export function hashPassword(password: string, salt = randomBytes(16).toString('base64url')): string {
  const derived = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString('base64url');
  return `pbkdf2$${PASSWORD_DIGEST}$${PASSWORD_ITERATIONS}$${salt}$${derived}`;
}

export function verifyPassword(password: string, encodedHash: string | undefined): boolean {
  if (!encodedHash) return false;
  const [scheme, digest, iterationsRaw, salt, expected] = encodedHash.split('$');
  const iterations = Number(iterationsRaw);
  if (scheme !== 'pbkdf2' || digest !== PASSWORD_DIGEST || !Number.isInteger(iterations) || !salt || !expected) return false;
  const actual = pbkdf2Sync(password, salt, iterations, Buffer.from(expected, 'base64url').length, digest).toString('base64url');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function loginWithPassword(input: LoginInput): Promise<LoginResult> {
  const identifier = input.identifier.trim();
  const user = await getUserRecordByLogin(identifier);

  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    await recordAuditEvent({
      action: 'login_failed',
      actor: { userId: identifier || undefined },
      entity: { type: 'auth_session', label: 'login' },
      reason: 'Invalid credentials.',
      metadata: { attemptedIdentifier: identifier },
    });
    throw new Error('Invalid credentials.');
  }

  if (!isUserActive(user)) {
    await recordAuditEvent({
      action: 'login_failed',
      actor: user,
      entity: { type: 'user', id: user.id, label: 'login' },
      before: { status: user.status },
      reason: 'Inactive account.',
    });
    throw new Error('Account is inactive. Contact a manager.');
  }

  const token = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Number(process.env.AUTH_SESSION_TTL_MS ?? DEFAULT_SESSION_TTL_MS)).toISOString();
  const session: AuthSessionRecord = {
    id: sessionIdForToken(token),
    userId: user.id,
    tokenHash: hashSessionToken(token),
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt,
  };
  await saveSession(session);

  await recordAuditEvent({
    action: 'login_succeeded',
    actor: user,
    entity: { type: 'auth_session', id: session.id, label: 'login' },
    after: { status: user.status, role: user.role, expiresAt },
  });

  return { user: toPublicUser(user), token, expiresAt };
}

export async function authenticateSessionToken(token: string): Promise<{ user: AuthenticatedUser; session: AuthSessionRecord } | null> {
  const session = await getSessionByToken(token);
  if (!session || session.revokedAt || session.expiresAt <= new Date().toISOString()) return null;

  const user = await getUserById(session.userId);
  if (!user || !isUserActive(user)) {
    await revokeSession(session.id, 'inactive_user');
    return null;
  }

  await touchSession(session.id);
  return { user, session };
}

export async function logoutSession(token: string, actor?: AuthenticatedUser): Promise<void> {
  const session = await getSessionByToken(token);
  if (!session || session.revokedAt) return;
  await revokeSession(session.id, 'logout');
  await recordAuditEvent({
    action: 'logout_succeeded',
    actor: actor ?? { userId: session.userId },
    entity: { type: 'auth_session', id: session.id, label: 'logout' },
  });
}
