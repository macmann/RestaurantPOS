import type { AuthenticatedUser } from '../../backend/auth/policies';
import type { Action } from '../../backend/auth/permissions';
import { apiClient } from '../api/client';

const SESSION_KEY = 'restaurant-pos-session';

export interface BrowserSession {
  user: AuthenticatedUser;
  permissions: Action[];
  token: string;
  expiresAt: string;
}

function isUsableSession(value: Partial<BrowserSession> | null | undefined): value is BrowserSession {
  if (!value?.user?.id || !value.token || !value.expiresAt) return false;
  const expiresAt = Date.parse(value.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function readStoredSession(): BrowserSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrowserSession>;
    if (isUsableSession(parsed)) return parsed;
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function storeSession(session: BrowserSession | null): void {
  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    apiClient.setSessionUser(session.user.id);
    apiClient.setSessionToken(session.token);
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
  apiClient.setSessionUser(undefined);
  apiClient.setSessionToken(undefined);
}

export function getStoredSession(): BrowserSession | null {
  const session = readStoredSession();
  apiClient.setSessionUser(session?.user.id);
  apiClient.setSessionToken(session?.token);
  return session;
}

export async function login(identifier: string, password: string): Promise<BrowserSession> {
  const session = await apiClient.login(identifier.trim(), password);
  storeSession(session);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await apiClient.logout();
  } finally {
    storeSession(null);
  }
}
