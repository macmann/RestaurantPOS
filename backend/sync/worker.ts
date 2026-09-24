import { applyIncomingLocally, markOutgoingResult, pendingOutbox } from './service';
import { query } from '../db/client';
import { loadSyncConfig, resolvedSyncEndpoints, SYNC_ENDPOINTS, syncEndpoint, type ResolvedSyncConfig } from './config';
import { isCloudDeployment } from '../config/environment';

export type SyncOperation = 'CONFIGURATION' | 'PUSH' | 'PULL' | 'ACKNOWLEDGEMENT' | 'HEARTBEAT';
export interface SyncDiagnosticError {
  operation: SyncOperation; occurredAt: string; method?: string; endpoint?: string; url?: string;
  httpStatus?: number; errorCode: string; message: string; responseMessage?: string; retryable: boolean; suggestedAction: string;
}
export interface SyncActivity { timestamp: string; operation: SyncOperation; outcome: 'SUCCESS' | 'ERROR'; eventCount?: number; httpStatus?: number; durationMs: number; message?: string; }
export interface PhaseResult { success: boolean; attempted?: number; accepted?: number; received?: number; applied?: number; ignoredAsStale?: number; httpStatus?: number; message?: string; }
export interface SyncCycleResult { status: 'completed' | 'completed_with_errors'; startedAt: string; completedAt: string; durationMs: number; push: PhaseResult; pull: PhaseResult; heartbeat: PhaseResult; }
export interface LocalSyncRuntimeStatus {
  state: 'DISABLED' | 'NOT_CONFIGURED' | 'IDLE' | 'SYNCING' | 'HEALTHY' | 'DEGRADED' | 'ERROR';
  lastSuccessfulPush?: string; lastSuccessfulPull?: string; lastHeartbeat?: string; lastError?: string;
  diagnosticError?: SyncDiagnosticError; phases: Record<'push' | 'pull' | 'heartbeat', { state: 'IDLE' | 'HEALTHY' | 'ERROR'; lastSuccess?: string; error?: SyncDiagnosticError }>;
  activity: SyncActivity[]; running: boolean;
}
const runtimeStatus: LocalSyncRuntimeStatus = { state: 'IDLE', phases: { push: { state: 'IDLE' }, pull: { state: 'IDLE' }, heartbeat: { state: 'IDLE' } }, activity: [], running: false };
let activeCycle: Promise<SyncCycleResult> | undefined;
export const getLocalSyncRuntimeStatus = (): LocalSyncRuntimeStatus => JSON.parse(JSON.stringify(runtimeStatus));
export const localSyncWorkerAllowed = (environment = process.env): boolean => !isCloudDeployment(environment);
export function clearLocalSyncDiagnosticError(): void { runtimeStatus.lastError = undefined; runtimeStatus.diagnosticError = undefined; }

const retryableStatus = (status?: number) => status === undefined || status === 408 || status === 429 || (status >= 500 && status <= 599);
export const sanitizeSyncDiagnosticText = (value: string): string => value
  .replace(/(authorization)\s*[=:]\s*[^,;]+/gi, '$1=[REDACTED]')
  .replace(/(x-sync-token|token|password)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]')
  .slice(0, 500);
export function syncSuggestedAction(status?: number, code?: string): string {
  if (status === 400) return 'Review the Store ID, Device ID, and request format.';
  if (status === 401) return 'The Sync API Token was rejected. Verify and replace the configured token.';
  if (status === 403) return 'Verify that this device and store are authorized by the cloud deployment.';
  if (status === 404) return 'The cloud server did not recognize this synchronization endpoint. Verify the Cloud Sync URL and that local and cloud deployments run compatible versions.';
  if (status === 429) return 'The cloud rate limit was reached. The worker will retry later.';
  if (status && status >= 500) return 'The cloud service reported a server error. Check cloud health and retry later.';
  if (code === 'TIMEOUT') return 'The cloud did not respond before the configured timeout. Check connectivity or increase the request timeout.';
  return 'Verify network, DNS, TLS, and cloud service availability, then retry.';
}
async function diagnostic(operation: SyncOperation, config: ResolvedSyncConfig, endpoint: { label?: string; method: string; path: string }, response?: Response, cause?: unknown): Promise<SyncDiagnosticError> {
  let responseMessage: string | undefined;
  if (response) { try { responseMessage = sanitizeSyncDiagnosticText(await response.text()); } catch { /* best effort */ } }
  const timeout = cause instanceof Error && (cause.name === 'TimeoutError' || /timeout/i.test(cause.message));
  const httpStatus = response?.status;
  const message = httpStatus ? `${endpoint.label ?? operation} HTTP ${httpStatus}` : timeout ? `${endpoint.label ?? operation} timed out` : sanitizeSyncDiagnosticText(cause instanceof Error ? cause.message : 'Synchronization failed.');
  return { operation, occurredAt: new Date().toISOString(), method: endpoint.method, endpoint: endpoint.path, url: syncEndpoint(config, endpoint.path), httpStatus,
    errorCode: httpStatus ? `HTTP_${httpStatus}` : timeout ? 'TIMEOUT' : 'NETWORK_ERROR', message, responseMessage, retryable: retryableStatus(httpStatus), suggestedAction: syncSuggestedAction(httpStatus, timeout ? 'TIMEOUT' : undefined) };
}
function record(operation: SyncOperation, started: number, success: boolean, count?: number, error?: SyncDiagnosticError): void {
  runtimeStatus.activity.unshift({ timestamp: new Date().toISOString(), operation, outcome: success ? 'SUCCESS' : 'ERROR', eventCount: count, httpStatus: error?.httpStatus, durationMs: Date.now() - started, message: error?.message });
  runtimeStatus.activity.splice(50);
  if (error) { runtimeStatus.lastError = error.message; runtimeStatus.diagnosticError = error; }
}
const headers = (config: ResolvedSyncConfig) => ({ 'content-type': 'application/json', 'x-sync-token': config.token! });

async function push(config: ResolvedSyncConfig, includeDeferred = false): Promise<PhaseResult> {
  const started = Date.now(); let ids: string[] = [];
  try {
    const events = await pendingOutbox(config.storeId, config.batchSize, includeDeferred); ids = events.map((event) => event.eventId);
    if (!events.length) { runtimeStatus.lastSuccessfulPush = new Date().toISOString(); runtimeStatus.phases.push = { state: 'HEALTHY', lastSuccess: runtimeStatus.lastSuccessfulPush }; record('PUSH', started, true, 0); return { success: true, attempted: 0, accepted: 0 }; }
    const response = await fetch(syncEndpoint(config, SYNC_ENDPOINTS.push.path), { method: SYNC_ENDPOINTS.push.method, headers: headers(config), body: JSON.stringify({ events }), signal: AbortSignal.timeout(config.requestTimeoutMs) });
    if (!response.ok) { const error = await diagnostic('PUSH', config, SYNC_ENDPOINTS.push, response); throw Object.assign(new Error(error.message), { diagnostic: error }); }
    await markOutgoingResult(ids); runtimeStatus.lastSuccessfulPush = new Date().toISOString(); runtimeStatus.phases.push = { state: 'HEALTHY', lastSuccess: runtimeStatus.lastSuccessfulPush }; record('PUSH', started, true, ids.length); return { success: true, attempted: ids.length, accepted: ids.length };
  } catch (cause) {
    const error = (cause as any)?.diagnostic ?? await diagnostic('PUSH', config, SYNC_ENDPOINTS.push, undefined, cause); await markOutgoingResult(ids, error.message).catch(() => undefined);
    runtimeStatus.phases.push = { state: 'ERROR', lastSuccess: runtimeStatus.lastSuccessfulPush, error }; record('PUSH', started, false, ids.length, error); return { success: false, attempted: ids.length, httpStatus: error.httpStatus, message: error.message };
  }
}
async function pull(config: ResolvedSyncConfig): Promise<PhaseResult> {
  const started = Date.now();
  try {
    const response = await fetch(`${syncEndpoint(config, SYNC_ENDPOINTS.pull.path)}?storeId=${encodeURIComponent(config.storeId)}`, { method: SYNC_ENDPOINTS.pull.method, headers: headers(config), signal: AbortSignal.timeout(config.requestTimeoutMs) });
    if (!response.ok) { const error = await diagnostic('PULL', config, SYNC_ENDPOINTS.pull, response); throw Object.assign(new Error(error.message), { diagnostic: error }); }
    const body = await response.json() as { data?: { events?: any[] } }; const events = body.data?.events ?? []; const acknowledged: string[] = []; let applied = 0; let ignoredAsStale = 0;
    for (const event of events) {
      if (String(event.store_id) !== config.storeId) throw new Error('Cloud returned an event for a different store.');
      const outcome = await applyIncomingLocally(event);
      if (outcome === 'APPLIED') applied += 1;
      else ignoredAsStale += 1;
      acknowledged.push(event.event_id);
    }
    if (acknowledged.length) {
      const ack = await fetch(syncEndpoint(config, SYNC_ENDPOINTS.acknowledgement.path), { method: SYNC_ENDPOINTS.acknowledgement.method, headers: headers(config), body: JSON.stringify({ storeId: config.storeId, eventIds: acknowledged }), signal: AbortSignal.timeout(config.requestTimeoutMs) });
      if (!ack.ok) { const error = await diagnostic('ACKNOWLEDGEMENT', config, SYNC_ENDPOINTS.acknowledgement, ack); throw Object.assign(new Error(error.message), { diagnostic: error }); }
    }
    runtimeStatus.lastSuccessfulPull = new Date().toISOString(); runtimeStatus.phases.pull = { state: 'HEALTHY', lastSuccess: runtimeStatus.lastSuccessfulPull }; record('PULL', started, true, events.length); return { success: true, received: events.length, applied, ignoredAsStale };
  } catch (cause) { const error = (cause as any)?.diagnostic ?? await diagnostic('PULL', config, SYNC_ENDPOINTS.pull, undefined, cause); runtimeStatus.phases.pull = { state: 'ERROR', lastSuccess: runtimeStatus.lastSuccessfulPull, error }; record(error.operation, started, false, undefined, error); return { success: false, httpStatus: error.httpStatus, message: error.message }; }
}
async function heartbeat(config: ResolvedSyncConfig): Promise<PhaseResult> {
  const started = Date.now();
  try {
    const counts = (await query<any>(`SELECT COUNT(*) FILTER(WHERE status='PENDING')::int pending, COUNT(*) FILTER(WHERE status='FAILED')::int failed, MAX(occurred_at) last_activity FROM sync_outbox WHERE store_id=$1`, [config.storeId])).rows[0];
    const response = await fetch(syncEndpoint(config, SYNC_ENDPOINTS.heartbeat.path), { method: SYNC_ENDPOINTS.heartbeat.method, headers: headers(config), signal: AbortSignal.timeout(config.requestTimeoutMs), body: JSON.stringify({ storeId: config.storeId, deviceId: config.deviceId, pendingEventCount: counts.pending, failedEventCount: counts.failed, lastPosActivity: counts.last_activity, applicationVersion: process.env.npm_package_version ?? 'unknown' }) });
    if (!response.ok) { const error = await diagnostic('HEARTBEAT', config, SYNC_ENDPOINTS.heartbeat, response); throw Object.assign(new Error(error.message), { diagnostic: error }); }
    runtimeStatus.lastHeartbeat = new Date().toISOString(); runtimeStatus.phases.heartbeat = { state: 'HEALTHY', lastSuccess: runtimeStatus.lastHeartbeat }; record('HEARTBEAT', started, true); return { success: true };
  } catch (cause) { const error = (cause as any)?.diagnostic ?? await diagnostic('HEARTBEAT', config, SYNC_ENDPOINTS.heartbeat, undefined, cause); runtimeStatus.phases.heartbeat = { state: 'ERROR', lastSuccess: runtimeStatus.lastHeartbeat, error }; record('HEARTBEAT', started, false, undefined, error); return { success: false, httpStatus: error.httpStatus, message: error.message }; }
}

export async function runSyncCycle(options: { rejectIfRunning?: boolean; includeDeferred?: boolean } = {}): Promise<SyncCycleResult> {
  if (activeCycle) { if (options.rejectIfRunning) throw Object.assign(new Error('Synchronization already in progress.'), { statusCode: 409 }); return activeCycle; }
  activeCycle = (async () => {
    const started = Date.now(); const startedAt = new Date().toISOString(); runtimeStatus.running = true; runtimeStatus.state = 'SYNCING';
    try {
      const config = await loadSyncConfig();
      if (!config.enabled || !config.configured) { runtimeStatus.state = !config.enabled ? 'DISABLED' : 'NOT_CONFIGURED'; throw Object.assign(new Error(!config.enabled ? 'Cloud synchronization is disabled.' : 'Cloud synchronization is not configured.'), { statusCode: 400 }); }
      const pushResult = await push(config, options.includeDeferred); const pullResult = await pull(config); const heartbeatResult = await heartbeat(config);
      const successes = [pushResult, pullResult, heartbeatResult].filter((phase) => phase.success).length;
      runtimeStatus.state = successes === 3 ? 'HEALTHY' : successes ? 'DEGRADED' : 'ERROR';
      if (successes === 3) clearLocalSyncDiagnosticError();
      const completedAt = new Date().toISOString(); return { status: successes === 3 ? 'completed' : 'completed_with_errors', startedAt, completedAt, durationMs: Date.now() - started, push: pushResult, pull: pullResult, heartbeat: heartbeatResult };
    } finally { runtimeStatus.running = false; }
  })();
  try { return await activeCycle; } finally { activeCycle = undefined; }
}

const delay = (ms: number, assign: (timer: ReturnType<typeof setTimeout>) => void) => new Promise<void>((resolve) => { const timer = setTimeout(resolve, ms); assign(timer); });
export class SyncWorker {
  private stopped = false; private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly configLoader: () => Promise<ResolvedSyncConfig> = loadSyncConfig) {}
  start(): void { if (!localSyncWorkerAllowed()) { this.stopped = true; return; } this.stopped = false; void this.loop(); }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  private async loop(): Promise<void> { while (!this.stopped) { let interval = 10_000; try { const config = await this.configLoader(); interval = Math.min(config.pushIntervalMs, config.pollIntervalMs); if (config.enabled && config.configured) await runSyncCycle(); else runtimeStatus.state = !config.enabled ? 'DISABLED' : 'NOT_CONFIGURED'; } catch (error) { runtimeStatus.lastError = error instanceof Error ? error.message : 'Synchronization failed.'; } await delay(interval, (timer) => { this.timer = timer; }); } }
}

export async function getSyncDiagnostics(): Promise<Record<string, unknown>> {
  const config = await loadSyncConfig(); let queues = { outbox: [] as any[], incoming: [] as any[] };
  try {
    const [outbox, incoming] = await Promise.all([
      query<any>(`SELECT event_id "eventId", entity_type "entityType", entity_id "entityId", operation, occurred_at "createdAt", attempt_count "attemptCount", next_attempt_at "nextRetry", LEFT(COALESCE(last_error,''),500) "lastError" FROM sync_outbox WHERE store_id=$1 AND status IN ('PENDING','FAILED') ORDER BY occurred_at LIMIT 100`, [config.storeId]),
      query<any>(`SELECT event_id "eventId", event_type "entityType", created_at "createdAt", processed_at "processedAt", outcome FROM sync_inbox WHERE processed_at IS NULL ORDER BY created_at LIMIT 100`),
    ]); queues = { outbox: outbox.rows, incoming: incoming.rows };
  } catch { /* memory/test mode */ }
  return { runtime: getLocalSyncRuntimeStatus(), endpoints: resolvedSyncEndpoints(config), queues, localProtocolVersion: '1', localApplicationVersion: process.env.APP_COMMIT ?? process.env.RENDER_GIT_COMMIT ?? process.env.npm_package_version ?? 'unknown' };
}
