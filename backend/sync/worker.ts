import { applyIncomingLocally, markOutgoingResult, pendingOutbox } from './service';
import { query } from '../db/client';
import { loadSyncConfig, syncEndpoint, type ResolvedSyncConfig } from './config';

export interface LocalSyncRuntimeStatus { lastSuccessfulPush?: string; lastSuccessfulPull?: string; lastHeartbeat?: string; lastError?: string; }
const runtimeStatus: LocalSyncRuntimeStatus = {};
export const getLocalSyncRuntimeStatus = (): LocalSyncRuntimeStatus => ({ ...runtimeStatus });

const delay = (ms: number, assign: (timer: ReturnType<typeof setTimeout>) => void) => new Promise<void>((resolve) => { const timer = setTimeout(resolve, ms); assign(timer); });

export class SyncWorker {
  private stopped = false;
  private pushTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly configLoader: () => Promise<ResolvedSyncConfig> = loadSyncConfig) {}
  start(): void { this.stopped = false; void this.pushLoop(); void this.pollLoop(); }
  stop(): void { this.stopped = true; if (this.pushTimer) clearTimeout(this.pushTimer); if (this.pollTimer) clearTimeout(this.pollTimer); }
  private headers(config: ResolvedSyncConfig) { return { 'content-type': 'application/json', 'x-sync-token': config.token! }; }
  private async pushLoop(): Promise<void> {
    while (!this.stopped) {
      let interval = 30_000;
      let attemptedEventIds: string[] = [];
      try {
        const config = await this.configLoader(); interval = config.pushIntervalMs;
        if (config.enabled && config.configured) {
          const events = await pendingOutbox(config.batchSize);
          if (events.length) {
            attemptedEventIds = events.map((event) => event.eventId);
            const response = await fetch(syncEndpoint(config, '/cloud/sync/events'), { method: 'POST', headers: this.headers(config), body: JSON.stringify({ events }), signal: AbortSignal.timeout(config.requestTimeoutMs) });
            if (!response.ok) throw new Error(`Cloud sync HTTP ${response.status}`);
            await markOutgoingResult(attemptedEventIds); attemptedEventIds = []; runtimeStatus.lastSuccessfulPush = new Date().toISOString();
          }
          await this.heartbeat(config); runtimeStatus.lastError = undefined;
        }
      } catch (error) {
        runtimeStatus.lastError = error instanceof Error ? error.message : 'Synchronization failed.';
        if (attemptedEventIds.length) await markOutgoingResult(attemptedEventIds, runtimeStatus.lastError).catch(() => undefined);
      }
      await delay(interval, (timer) => { this.pushTimer = timer; });
    }
  }
  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      let interval = 10_000;
      try {
        const config = await this.configLoader(); interval = config.pollIntervalMs;
        if (config.enabled && config.configured) {
          const response = await fetch(`${syncEndpoint(config, '/cloud/sync/incoming')}?storeId=${encodeURIComponent(config.storeId)}`, { headers: this.headers(config), signal: AbortSignal.timeout(config.requestTimeoutMs) });
          if (!response.ok) throw new Error(`Cloud poll HTTP ${response.status}`);
          const body = await response.json() as { data: { events: any[] } }; const acknowledged: string[] = [];
          for (const event of body.data.events) {
            if (String(event.store_id) !== config.storeId) throw new Error('Cloud returned an event for a different store.');
            await applyIncomingLocally(event); acknowledged.push(event.event_id);
          }
          if (acknowledged.length) {
            const ack = await fetch(syncEndpoint(config, '/cloud/sync/incoming/ack'), { method: 'POST', headers: this.headers(config), body: JSON.stringify({ storeId: config.storeId, eventIds: acknowledged }), signal: AbortSignal.timeout(config.requestTimeoutMs) });
            if (!ack.ok) throw new Error(`Cloud acknowledgement HTTP ${ack.status}`);
          }
          runtimeStatus.lastSuccessfulPull = new Date().toISOString(); runtimeStatus.lastError = undefined;
        }
      } catch (error) { runtimeStatus.lastError = error instanceof Error ? error.message : 'Synchronization failed.'; }
      await delay(interval, (timer) => { this.pollTimer = timer; });
    }
  }
  private async heartbeat(config: ResolvedSyncConfig): Promise<void> {
    const counts = (await query<any>(`SELECT COUNT(*) FILTER(WHERE status='PENDING')::int pending, COUNT(*) FILTER(WHERE status='FAILED')::int failed, MAX(occurred_at) last_activity FROM sync_outbox WHERE store_id=$1`, [config.storeId])).rows[0];
    const response = await fetch(syncEndpoint(config, '/cloud/sync/heartbeat'), { method: 'POST', headers: this.headers(config), signal: AbortSignal.timeout(config.requestTimeoutMs), body: JSON.stringify({ storeId:config.storeId, deviceId:config.deviceId, pendingEventCount:counts.pending, failedEventCount:counts.failed, lastPosActivity:counts.last_activity, applicationVersion:process.env.npm_package_version ?? 'unknown' }) });
    if (!response.ok) throw new Error(`Cloud heartbeat HTTP ${response.status}`); runtimeStatus.lastHeartbeat = new Date().toISOString();
  }
}
