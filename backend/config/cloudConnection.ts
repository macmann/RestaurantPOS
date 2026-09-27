import { isCloudDeployment, readAppMode } from './environment';
import { getRuntimeSettings } from './branch';
import { isSqlRepositoryEnabled, query } from '../db/client';

type Environment = Record<string, string | undefined>;
export type CloudReadiness = 'READY' | 'NOT_CONFIGURED' | 'STORE_NOT_CONFIGURED' | 'DATABASE_UNAVAILABLE' | 'TOKEN_NOT_CONFIGURED' | 'ERROR';

export const CLOUD_SYNC_ENDPOINTS = {
  test: { method: 'POST', path: '/cloud/sync/test' },
  push: { method: 'POST', path: '/cloud/sync/events' },
  incoming: { method: 'GET', path: '/cloud/sync/incoming' },
  acknowledgeIncoming: { method: 'POST', path: '/cloud/sync/incoming/ack' },
  heartbeat: { method: 'POST', path: '/cloud/sync/heartbeat' },
} as const;

/** Validate and canonicalize the internet-facing application origin. */
export function normalizePublicBaseUrl(value: string | undefined, environment: Environment = process.env): string | null {
  const text = value?.trim();
  if (!text) return null;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('PUBLIC_BASE_URL must be an absolute URL.'); }
  const runtimeEnvironment = environment.NODE_ENV ?? environment.APP_ENV ?? '';
  const development = runtimeEnvironment.toLowerCase() !== 'production';
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:')) throw new Error('PUBLIC_BASE_URL must use HTTPS (HTTP localhost is allowed only outside production).');
  if (url.username || url.password) throw new Error('PUBLIC_BASE_URL must not contain credentials.');
  if (url.search || url.hash) throw new Error('PUBLIC_BASE_URL must not contain a query or fragment.');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('PUBLIC_BASE_URL must be an origin without a path (do not include an API endpoint).');
  return url.origin;
}

export function resolvePublicBaseUrl(environment: Environment = process.env): string | null {
  if (environment.PUBLIC_BASE_URL?.trim()) return normalizePublicBaseUrl(environment.PUBLIC_BASE_URL, environment);
  // Render owns this metadata value, unlike request Host headers. Explicit PUBLIC_BASE_URL remains preferred.
  const renderHostname = environment.RENDER_EXTERNAL_HOSTNAME?.trim();
  return renderHostname ? normalizePublicBaseUrl(`https://${renderHostname}`, environment) : null;
}

/** A cloud deployment must explicitly claim a store instead of silently using
 * the generic `main` branch.  Otherwise a POS can authenticate successfully
 * while manager edits are written to a different branch partition. */
export function resolveCloudStoreId(environment: Environment = process.env): string | null {
  const explicitStore = environment.POS_STORE_ID?.trim();
  if (explicitStore) return explicitStore;
  if (environment.POS_BRANCH_ID?.trim() || environment.RESTAURANT_BRANCH_ID?.trim()) return getRuntimeSettings(environment).branch.branchId;
  return null;
}

export async function getCloudConnectionInformation(environment: Environment = process.env) {
  const deploymentMode = readAppMode(environment);
  const publicBaseUrl = resolvePublicBaseUrl(environment);
  const tokenConfigured = Boolean(environment.SYNC_API_TOKEN?.trim());
  let databaseAvailable = false;
  let databaseError = false;
  if (isSqlRepositoryEnabled()) {
    try { await query('SELECT 1'); databaseAvailable = true; } catch { databaseError = true; }
  }
  const syncApiAvailable = isCloudDeployment(environment);
  const configuredStoreId = resolveCloudStoreId(environment);
  const storeId = configuredStoreId ?? 'Not configured';
  let status: CloudReadiness = 'READY';
  if (!syncApiAvailable || !publicBaseUrl) status = 'NOT_CONFIGURED';
  else if (!configuredStoreId) status = 'STORE_NOT_CONFIGURED';
  else if (databaseError || !databaseAvailable) status = 'DATABASE_UNAVAILABLE';
  else if (!tokenConfigured) status = 'TOKEN_NOT_CONFIGURED';

  return {
    deploymentMode,
    publicBaseUrl,
    syncApiAvailable,
    syncApiReady: status === 'READY',
    tokenConfigured,
    databaseAvailable,
    status,
    endpoints: CLOUD_SYNC_ENDPOINTS,
    storeId: { value: storeId, configured: Boolean(configuredStoreId), format: 'restaurant/location assignment', guidance: configuredStoreId ? 'Use this exact ID when configuring the restaurant POS. Store IDs remain store-scoped.' : 'Set POS_STORE_ID on the cloud to the same stable value as the local POS_BRANCH_ID.' },
    deviceId: { format: 'restaurant-defined device identifier', example: 'register-server-1', guidance: 'Define a unique ID for each local POS/server device.' },
    recommendedLocalSettings: { pushIntervalSeconds: 30, pollIntervalSeconds: 10, requestTimeoutSeconds: 8, batchSize: 100 },
  };
}
