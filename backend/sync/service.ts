import { randomUUID } from 'node:crypto';
import { query, withTransaction, type DatabaseClient } from '../db/client';

export type SyncEvent = {
  eventId: string; storeId: string; entityType: string; entityId: string;
  operation: 'UPSERT' | 'DELETE'; payload: Record<string, unknown>; occurredAt: string;
};

const MIRRORED_TABLES = new Set(['branches', 'roles', 'users', 'menu_categories', 'menu_items', 'tables', 'table_sessions', 'orders', 'order_items', 'bills', 'bill_splits', 'payments', 'inventory_items', 'stock_ledger', 'online_orders', 'reservations']);
const BIDIRECTIONAL_MENU_TABLES = new Set(['menu_categories', 'menu_items']);
export type SyncOutcome = 'APPLIED' | 'STALE_IGNORED' | 'ALREADY_PROCESSED';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

export function compareMenuVersions(incoming: { updatedAt?: string; updatedSource?: string }, current?: { updatedAt?: string; updatedSource?: string } | null): 'NEWER' | 'STALE' | 'EQUAL' {
  if (!current) return 'NEWER';
  const incomingTime = Date.parse(String(incoming.updatedAt ?? ''));
  const currentTime = Date.parse(String(current.updatedAt ?? ''));
  if (!Number.isFinite(incomingTime)) throw new Error('Menu sync payload requires a valid trusted updatedAt timestamp.');
  if (!Number.isFinite(currentTime) || incomingTime > currentTime) return 'NEWER';
  if (incomingTime < currentTime) return 'STALE';
  const incomingState = canonicalJson(incoming);
  const currentState = canonicalJson(current);
  if (incomingState === currentState) return 'EQUAL';
  // Equal instants are rare but possible. Fixed source priority followed by a
  // canonical-state tie-break guarantees convergence without an echo loop.
  const sourcePriority = (source?: string) => source === 'CLOUD_MANAGER' ? 2 : source === 'LOCAL_POS' ? 1 : 0;
  const priorityDifference = sourcePriority(incoming.updatedSource) - sourcePriority(current.updatedSource);
  if (priorityDifference !== 0) return priorityDifference > 0 ? 'NEWER' : 'STALE';
  return incomingState > currentState ? 'NEWER' : 'STALE';
}

function menuNamespace(entityType: string): 'menu:categories' | 'menu:items' {
  if (entityType === 'menu_categories') return 'menu:categories';
  if (entityType === 'menu_items') return 'menu:items';
  throw new Error(`Unsupported bidirectional menu entity: ${entityType}`);
}

async function applyMenuVersion(client: DatabaseClient, event: { eventId: string; storeId: string; entityType: string; entityId: string; payload: Record<string, unknown> }, suppressLocalOutbox: boolean): Promise<SyncOutcome> {
  const namespace = menuNamespace(event.entityType);
  if (String(event.payload.id ?? '') !== event.entityId) throw new Error('Menu sync identity does not match its payload.');
  if (String(event.payload.branchId ?? '') !== event.storeId) throw new Error('Menu sync store scope does not match its payload.');
  const existing = await client.query<{ payload: Record<string, unknown> }>('SELECT payload FROM repository_records WHERE namespace=$1 AND record_key=$2 FOR UPDATE', [namespace, event.entityId]);
  const comparison = compareMenuVersions(event.payload as any, existing.rows[0]?.payload as any);
  const outcome: SyncOutcome = comparison === 'NEWER' ? 'APPLIED' : comparison === 'STALE' ? 'STALE_IGNORED' : 'ALREADY_PROCESSED';
  if (outcome === 'APPLIED') {
    if (suppressLocalOutbox) await client.query(`SET LOCAL restaurant_pos.sync_origin = 'CLOUD_MANAGER'`);
    await client.query(`INSERT INTO repository_records(namespace,record_key,payload,created_at,updated_at) VALUES($1,$2,$3::jsonb,NOW(),NOW()) ON CONFLICT(namespace,record_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`, [namespace, event.entityId, JSON.stringify(event.payload)]);
  }
  await client.query(`INSERT INTO menu_sync_audit(event_id,store_id,entity_type,entity_id,outcome,updated_source,updated_by,version_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [event.eventId, event.storeId, event.entityType, event.entityId, outcome, event.payload.updatedSource ?? null, event.payload.updatedBy ?? null, event.payload.updatedAt]);
  return outcome;
}

export function appMode(env = process.env): 'POS' | 'CLOUD' {
  return String(env.APP_MODE ?? 'POS').toUpperCase() === 'CLOUD' ? 'CLOUD' : 'POS';
}

export function requireSyncToken(value: unknown): void {
  const expected = process.env.SYNC_API_TOKEN;
  if (!expected || value !== expected) throw Object.assign(new Error('Invalid sync service credential.'), { statusCode: 401 });
}

/** Apply a whole batch atomically. processed_sync_events makes lost acknowledgements safe. */
export async function receiveOutgoingBatch(events: SyncEvent[]): Promise<{ accepted: string[]; outcomes: Record<string, SyncOutcome> }> {
  const accepted: string[] = [];
  const outcomes: Record<string, SyncOutcome> = {};
  await withTransaction(async (client) => {
    for (const event of events) {
      if (!MIRRORED_TABLES.has(event.entityType)) throw new Error(`Unsupported synchronized entity: ${event.entityType}`);
      const claimed = await client.query('INSERT INTO processed_sync_events(event_id, store_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id', [event.eventId, event.storeId]);
      if (!claimed.rowCount) {
        outcomes[event.eventId] = 'ALREADY_PROCESSED';
      } else if (BIDIRECTIONAL_MENU_TABLES.has(event.entityType)) {
        const normalized = event.operation === 'DELETE' ? { ...event, payload: { ...event.payload, deletedAt: event.occurredAt, updatedAt: event.occurredAt, updatedSource: 'LOCAL_POS' } } : event;
        outcomes[event.eventId] = await applyMenuVersion(client, normalized, false);
      } else {
        if (event.operation === 'DELETE') {
          await client.query(`DELETE FROM ${event.entityType} WHERE id = $1`, [event.entityId]);
        } else {
          // The shared schema is intentionally used on both sides. Updating via
          // jsonb_populate_record copies every compatible business column.
          const updated = await client.query(`UPDATE ${event.entityType} AS target SET ${event.entityType} = source FROM jsonb_populate_record(NULL::${event.entityType}, $1::jsonb) source WHERE target.id=$2`, [JSON.stringify(event.payload), event.entityId]);
          if (!updated.rowCount) await client.query(`INSERT INTO ${event.entityType} SELECT * FROM jsonb_populate_record(NULL::${event.entityType}, $1::jsonb)`, [JSON.stringify(event.payload)]);
        }
      }
      accepted.push(event.eventId);
    }
  });
  return { accepted, outcomes };
}

export async function pendingOutbox(limit: number): Promise<SyncEvent[]> {
  const result = await query<any>(`SELECT event_id, store_id, entity_type, entity_id, operation, payload, occurred_at FROM sync_outbox WHERE status IN ('PENDING','FAILED') AND next_attempt_at <= NOW() ORDER BY occurred_at LIMIT $1`, [limit]);
  return result.rows.map((row) => ({ eventId: row.event_id, storeId: row.store_id, entityType: row.entity_type, entityId: row.entity_id, operation: row.operation, payload: row.payload, occurredAt: row.occurred_at }));
}

export async function markOutgoingResult(ids: string[], error?: string): Promise<void> {
  if (!ids.length) return;
  if (!error) await query(`UPDATE sync_outbox SET status='SYNCED', synced_at=NOW(), last_error=NULL WHERE event_id = ANY($1::uuid[])`, [ids]);
  else await query(`UPDATE sync_outbox SET status='FAILED', attempt_count=attempt_count+1, last_error=$2, next_attempt_at=NOW() + LEAST(INTERVAL '1 hour', INTERVAL '5 seconds' * POWER(2, LEAST(attempt_count, 9))) WHERE event_id = ANY($1::uuid[])`, [ids, error.slice(0, 2000)]);
}

export async function getIncomingEvents(storeId: string, limit = 100): Promise<any[]> {
  const result = await query<any>('SELECT event_id, store_id, event_type, payload, created_at FROM incoming_pos_events WHERE store_id=$1 AND acknowledged_at IS NULL ORDER BY created_at LIMIT $2', [storeId, limit]);
  return result.rows;
}

export async function acknowledgeIncoming(storeId: string, ids: string[]): Promise<void> {
  await query('UPDATE incoming_pos_events SET acknowledged_at=NOW() WHERE store_id=$1 AND event_id=ANY($2::uuid[])', [storeId, ids]);
}

/** Persist before applying; a duplicate event is a no-op and is safe to acknowledge. */
export async function applyIncomingLocally(event: any): Promise<void> {
  await withTransaction(async (client) => {
    const inserted = await client.query('INSERT INTO sync_inbox(event_id,event_type,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id', [event.event_id, event.event_type, event.payload]);
    if (!inserted.rowCount) return;
    const p = event.payload;
    if (event.event_type === 'ONLINE_ORDER_CREATED') {
      await client.query(`INSERT INTO online_orders(id,store_id,customer_id,customer_name,customer_phone,requested_pickup_at,status,total,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'RECEIVED_BY_POS',$7,$8,$8) ON CONFLICT(id) DO NOTHING`, [p.id,p.storeId,p.customerId,p.customerName,p.customerPhone,p.requestedPickupAt ?? null,p.total,p.createdAt]);
    } else if (event.event_type === 'RESERVATION_CREATED') {
      await client.query(`INSERT INTO reservations(id,store_id,customer_id,customer_name,customer_phone,requested_at,party_size,notes,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RECEIVED_BY_POS',$9,$9) ON CONFLICT(id) DO NOTHING`, [p.id,p.storeId,p.customerId,p.customerName,p.customerPhone,p.requestedAt,p.partySize,p.notes ?? null,p.createdAt]);
    } else if (String(event.event_type).startsWith('MENU_ITEM_') || String(event.event_type).startsWith('CATEGORY_')) {
      const entityType = String(event.event_type).startsWith('MENU_ITEM_') ? 'menu_items' : 'menu_categories';
      const outcome = await applyMenuVersion(client, { eventId: event.event_id, storeId: event.store_id, entityType, entityId: p.id, payload: p }, true);
      await client.query('UPDATE sync_inbox SET processed_at=NOW(),outcome=$2 WHERE event_id=$1', [event.event_id, outcome]);
      return;
    }
    await client.query(`UPDATE sync_inbox SET processed_at=NOW(),outcome='APPLIED' WHERE event_id=$1`, [event.event_id]);
  });
}

export async function syncHealth(storeId: string): Promise<Record<string, unknown>> {
  const [status, counts] = await Promise.all([
    query<any>('SELECT * FROM store_sync_status WHERE store_id=$1', [storeId]),
    query<any>(`SELECT COUNT(*) FILTER (WHERE status='PENDING')::int pending, COUNT(*) FILTER (WHERE status='FAILED')::int failed FROM sync_outbox WHERE store_id=$1`, [storeId]),
  ]);
  const row = status.rows[0];
  if (!row) return { storeId, state: 'REMOTE STATUS UNKNOWN', pending: counts.rows[0]?.pending ?? 0, failed: counts.rows[0]?.failed ?? 0 };
  const ageSeconds = Math.max(0, (Date.now() - new Date(row.last_seen_at).getTime()) / 1000);
  return { ...row, ageSeconds, state: ageSeconds <= 90 ? 'CURRENT' : 'DELAYED', pending: counts.rows[0]?.pending ?? 0, failed: counts.rows[0]?.failed ?? 0 };
}

export async function createCustomerAccount(name: string, phone: string): Promise<any> {
  return (await query<any>('INSERT INTO customer_web_accounts(id,name,phone) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name RETURNING id,name,phone,phone_verified_at', [randomUUID(), name, phone])).rows[0];
}
