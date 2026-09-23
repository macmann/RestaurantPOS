import { applyIncomingLocally, markOutgoingResult, pendingOutbox } from './service';
import { query } from '../db/client';

const numberEnv = (name: string, fallback: number) => Math.max(1000, Number(process.env[name] ?? fallback) || fallback);

export class SyncWorker {
  private stopped = false;
  private pushTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly baseUrl = process.env.CLOUD_API_URL ?? '', private readonly token = process.env.SYNC_API_TOKEN ?? '', private readonly storeId = process.env.POS_STORE_ID ?? 'default') {}
  start(): void {
    if (!this.baseUrl || !this.token) return;
    this.stopped = false; void this.pushLoop(); void this.pollLoop();
  }
  stop(): void { this.stopped = true; if (this.pushTimer) clearTimeout(this.pushTimer); if (this.pollTimer) clearTimeout(this.pollTimer); }
  private headers() { return { 'content-type': 'application/json', 'x-sync-token': this.token }; }
  private async pushLoop(): Promise<void> {
    while (!this.stopped) {
      const events = await pendingOutbox(Number(process.env.SYNC_BATCH_SIZE ?? 100)).catch(() => []);
      if (events.length) {
        try {
          const response = await fetch(`${this.baseUrl}/cloud/sync/events`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ events }), signal: AbortSignal.timeout(numberEnv('SYNC_REQUEST_TIMEOUT_MS', 8000)) });
          if (!response.ok) throw new Error(`Cloud sync HTTP ${response.status}`);
          await markOutgoingResult(events.map((e) => e.eventId));
        } catch (error) { await markOutgoingResult(events.map((e) => e.eventId), error instanceof Error ? error.message : String(error)).catch(() => undefined); }
      }
      await this.heartbeat().catch(() => undefined);
      await new Promise<void>((resolve) => { this.pushTimer = setTimeout(resolve, numberEnv('SYNC_PUSH_INTERVAL_MS', 30_000)); });
    }
  }
  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const response = await fetch(`${this.baseUrl}/cloud/sync/incoming?storeId=${encodeURIComponent(this.storeId)}`, { headers: this.headers(), signal: AbortSignal.timeout(numberEnv('SYNC_REQUEST_TIMEOUT_MS', 8000)) });
        if (!response.ok) throw new Error(`Cloud poll HTTP ${response.status}`);
        const body = await response.json() as { data: { events: any[] } };
        const acknowledged: string[] = [];
        for (const event of body.data.events) { await applyIncomingLocally(event); acknowledged.push(event.event_id); }
        if (acknowledged.length) await fetch(`${this.baseUrl}/cloud/sync/incoming/ack`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ storeId: this.storeId, eventIds: acknowledged }) });
      } catch { /* Local POS availability must never depend on this loop. */ }
      await new Promise<void>((resolve) => { this.pollTimer = setTimeout(resolve, numberEnv('SYNC_POLL_INTERVAL_MS', 10_000)); });
    }
  }
  private async heartbeat(): Promise<void> {
    const counts = (await query<any>(`SELECT COUNT(*) FILTER(WHERE status='PENDING')::int pending, COUNT(*) FILTER(WHERE status='FAILED')::int failed, MAX(occurred_at) last_activity FROM sync_outbox WHERE store_id=$1`, [this.storeId])).rows[0];
    await fetch(`${this.baseUrl}/cloud/sync/heartbeat`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ storeId:this.storeId, deviceId:process.env.POS_DEVICE_ID ?? this.storeId, pendingEventCount:counts.pending, failedEventCount:counts.failed, lastPosActivity:counts.last_activity, applicationVersion:process.env.npm_package_version ?? 'unknown' }) });
  }
}
