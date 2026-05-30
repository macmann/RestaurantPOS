import type { AuthenticatedUser } from '../../backend/auth/policies';
import type { Action } from '../../backend/auth/permissions';
import { apiClient } from '../api/client';

const SESSION_KEY = 'restaurant-pos-session';

export interface BrowserSession {
  user: AuthenticatedUser;
  permissions: Action[];
}

function readStoredSession(): BrowserSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as BrowserSession) : null;
  } catch {
    return null;
  }
}

function storeSession(session: BrowserSession | null): void {
  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    apiClient.setSessionUser(session.user.id);
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
  apiClient.setSessionUser(undefined);
}

export function getStoredSession(): BrowserSession | null {
  const session = readStoredSession();
  apiClient.setSessionUser(session?.user.id);
  return session;
}

export async function login(userId: string): Promise<BrowserSession> {
  const session = await apiClient.login(userId.trim());
  storeSession(session);
  return session;
}

export function logout(): void {
  storeSession(null);
}
