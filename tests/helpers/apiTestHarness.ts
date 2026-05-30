import type { Server } from 'http';
import { createApp } from '../../backend/server';
import { hashPassword } from '../../backend/auth/service';
import { saveUser } from '../../backend/users/repository';
import type { PublicUserProfile } from '../../backend/users/repository';
import type { AuthenticatedUser } from '../../backend/auth/policies';

export interface TestServerHandle {
  baseUrl: string;
  close(): Promise<void>;
}

export interface ApiResponse<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

export async function startTestServer(): Promise<TestServerHandle> {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance as Server));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to determine test server address.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export async function seedLoginUser(input: AuthenticatedUser & { username?: string; email?: string; password: string }): Promise<PublicUserProfile> {
  return saveUser({
    ...input,
    username: input.username ?? input.id,
    email: input.email,
    passwordHash: hashPassword(input.password),
  });
}

export async function apiRequest<T = any>(baseUrl: string, path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers, body });
  const contentType = response.headers.get('content-type') ?? '';
  const parsed = contentType.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, headers: response.headers, body: parsed as T };
}

export async function login(baseUrl: string, identifier: string, password: string): Promise<{ token: string; user: PublicUserProfile; permissions: string[] }> {
  const response = await apiRequest<{ data: { token: string; user: PublicUserProfile; permissions: string[] } }>(baseUrl, '/auth/login', {
    method: 'POST',
    body: { identifier, password },
  });
  if (response.status !== 200) throw new Error(`Login failed with ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body.data;
}
