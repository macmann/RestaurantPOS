import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { isSqlRepositoryEnabled, withTransaction } from '../db/client';
import { getRecord, putRecord } from '../db/repositoryStore';
import { getCurrentBranchId } from '../config/branch';

export interface StoredSyncSettings {
  enabled: boolean;
  cloudSyncBaseUrl: string | null;
  storeId: string;
  deviceId: string;
  pushIntervalMs: number;
  pollIntervalMs: number;
  requestTimeoutMs: number;
  batchSize: number;
  successRetentionDays: number;
}

export type SyncSettingSource = 'platform' | 'environment' | 'default';
export interface ResolvedSyncConfig extends StoredSyncSettings {
  token: string | null;
  tokenConfigured: boolean;
  sources: Record<keyof StoredSyncSettings | 'token', SyncSettingSource>;
  configured: boolean;
}

/** The protocol route catalogue is shared by the worker and diagnostics UI. */
export const SYNC_ENDPOINTS = {
  test: { label: 'Connection test', method: 'POST', path: '/cloud/sync/test' },
  push: { label: 'Push', method: 'POST', path: '/cloud/sync/events' },
  pull: { label: 'Incoming pull', method: 'GET', path: '/cloud/sync/incoming' },
  acknowledgement: { label: 'Acknowledgement', method: 'POST', path: '/cloud/sync/incoming/ack' },
  heartbeat: { label: 'Heartbeat', method: 'POST', path: '/cloud/sync/heartbeat' },
} as const;
export const LOCAL_SYNC_PROTOCOL_VERSION = '1';

type EncryptedSecret = { version: 1; iv: string; tag: string; ciphertext: string };
const SETTINGS_KEY = 'local-pos';
const DEFAULTS: StoredSyncSettings = { enabled: false, cloudSyncBaseUrl: null, storeId: 'default', deviceId: 'default', pushIntervalMs: 30_000, pollIntervalMs: 10_000, requestTimeoutMs: 8_000, batchSize: 100, successRetentionDays: 30 };
let memorySettings: StoredSyncSettings | null = null;
let memorySecret: EncryptedSecret | null = null;

const envText = (name: string): string | undefined => process.env[name]?.trim() || undefined;
const envNumber = (name: string, fallback: number): number => {
  const value = Number(envText(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
function encryptionKey(): Buffer {
  const material = envText('SYNC_SETTINGS_ENCRYPTION_KEY');
  if (!material) throw new Error('SYNC_SETTINGS_ENCRYPTION_KEY is required to securely save a Sync API Token.');
  return createHash('sha256').update(material).digest();
}
function encrypt(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
function decrypt(value: EncryptedSecret): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
async function stored(): Promise<{ settings: StoredSyncSettings | null; secret: EncryptedSecret | null }> {
  if (!isSqlRepositoryEnabled()) return { settings: memorySettings, secret: memorySecret };
  return { settings: await getRecord<StoredSyncSettings>('settings:cloud-sync', SETTINGS_KEY), secret: await getRecord<EncryptedSecret>('secrets:cloud-sync', SETTINGS_KEY) };
}
function normalizeUrl(value: unknown): string | null {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (!text) return null;
  const url = new URL(text);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) throw new Error('Cloud Sync URL must use HTTPS (HTTP is allowed only for localhost).');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Cloud Sync URL must be a base URL without a path, query, or fragment.');
  return text;
}
const boundedInt = (value: unknown, field: string, min: number, max: number): number => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${field} must be an integer between ${min} and ${max}.`);
  return number;
};
export function validateSyncSettings(input: any): StoredSyncSettings {
  if (typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean.');
  const storeId = String(input.storeId ?? '').trim(); const deviceId = String(input.deviceId ?? '').trim();
  if (!storeId) throw new Error('Store ID is required.');
  if (!deviceId) throw new Error('Device ID is required.');
  const branchId = getCurrentBranchId();
  if (storeId !== branchId) throw new Error(`Store ID must match this POS branch ID (${branchId}) so cloud changes can be delivered back to this restaurant.`);
  return { enabled: input.enabled, cloudSyncBaseUrl: normalizeUrl(input.cloudSyncBaseUrl), storeId, deviceId,
    pushIntervalMs: boundedInt(input.pushIntervalMs, 'Push interval', 5_000, 86_400_000), pollIntervalMs: boundedInt(input.pollIntervalMs, 'Incoming poll interval', 5_000, 86_400_000),
    requestTimeoutMs: boundedInt(input.requestTimeoutMs, 'Request timeout', 1_000, 120_000), batchSize: boundedInt(input.batchSize, 'Sync batch size', 1, 1_000), successRetentionDays: boundedInt(input.successRetentionDays, 'Success retention', 1, 3_650) };
}
export async function loadSyncConfig(): Promise<ResolvedSyncConfig> {
  const db = await stored();
  const branchId = getCurrentBranchId();
  const environment: StoredSyncSettings = {
    enabled: Boolean(envText('CLOUD_API_URL') && envText('SYNC_API_TOKEN')),
    cloudSyncBaseUrl: normalizeUrl(envText('CLOUD_API_URL')),
    storeId: envText('POS_STORE_ID') ?? branchId, deviceId: envText('POS_DEVICE_ID') ?? envText('POS_STORE_ID') ?? DEFAULTS.deviceId,
    pushIntervalMs: envNumber('SYNC_PUSH_INTERVAL_MS', DEFAULTS.pushIntervalMs), pollIntervalMs: envNumber('SYNC_POLL_INTERVAL_MS', DEFAULTS.pollIntervalMs), requestTimeoutMs: envNumber('SYNC_REQUEST_TIMEOUT_MS', DEFAULTS.requestTimeoutMs), batchSize: envNumber('SYNC_BATCH_SIZE', DEFAULTS.batchSize), successRetentionDays: envNumber('SYNC_SUCCESS_RETENTION_DAYS', DEFAULTS.successRetentionDays),
  };
  const storedSettings = db.settings;
  const result = storedSettings
    ? { ...storedSettings, storeId: storedSettings.storeId === DEFAULTS.storeId ? branchId : storedSettings.storeId }
    : environment;
  let token = envText('SYNC_API_TOKEN') ?? null;
  if (db.secret) token = decrypt(db.secret);
  const environmentNames: Record<keyof StoredSyncSettings, string | string[]> = { enabled: ['CLOUD_API_URL', 'SYNC_API_TOKEN'], cloudSyncBaseUrl: 'CLOUD_API_URL', storeId: 'POS_STORE_ID', deviceId: 'POS_DEVICE_ID', pushIntervalMs: 'SYNC_PUSH_INTERVAL_MS', pollIntervalMs: 'SYNC_POLL_INTERVAL_MS', requestTimeoutMs: 'SYNC_REQUEST_TIMEOUT_MS', batchSize: 'SYNC_BATCH_SIZE', successRetentionDays: 'SYNC_SUCCESS_RETENTION_DAYS' };
  const sources = Object.fromEntries([...Object.keys(DEFAULTS).map((key) => {
    const names = environmentNames[key as keyof StoredSyncSettings]; const present = (Array.isArray(names) ? names : [names]).every((name) => Boolean(envText(name)));
    return [key, db.settings ? 'platform' : present ? 'environment' : 'default'];
  }), ['token', db.secret ? 'platform' : token ? 'environment' : 'default']]) as ResolvedSyncConfig['sources'];
  return { ...result, token, tokenConfigured: Boolean(token), sources, configured: Boolean(result.cloudSyncBaseUrl && token && result.storeId && result.deviceId) };
}
export async function saveSyncConfig(input: any): Promise<ResolvedSyncConfig> {
  const settings = validateSyncSettings(input);
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const secret = token ? encrypt(token) : null;
  if (isSqlRepositoryEnabled()) {
    await withTransaction(async () => {
      await putRecord('settings:cloud-sync', SETTINGS_KEY, settings);
      if (secret) await putRecord('secrets:cloud-sync', SETTINGS_KEY, secret);
    });
  } else {
    memorySettings = settings;
    if (secret) memorySecret = secret;
  }
  return loadSyncConfig();
}
export function publicSyncConfig(config: ResolvedSyncConfig) { const { token: _token, ...safe } = config; return safe; }
export const syncEndpoint = (config: Pick<ResolvedSyncConfig, 'cloudSyncBaseUrl'>, path: string) => `${config.cloudSyncBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
export function resolvedSyncEndpoints(config: Pick<ResolvedSyncConfig, 'cloudSyncBaseUrl'>) {
  return Object.fromEntries(Object.entries(SYNC_ENDPOINTS).map(([key, endpoint]) => [key, { ...endpoint, url: config.cloudSyncBaseUrl ? syncEndpoint(config, endpoint.path) : null }]));
}
