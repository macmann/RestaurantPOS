import { isSqlRepositoryEnabled } from '../db/client';
import { listRecords, putRecord } from '../db/repositoryStore';

export const AUDIT_ACTIONS = [
  'login_succeeded',
  'login_failed',
  'logout_succeeded',
  'user_created',
  'user_updated',
  'user_activated',
  'user_deactivated',
  'password_changed',
  'order_edited',
  'order_cancelled',
  'bill_voided',
  'stock_adjusted',
  'tax_toggled',
  'discount_applied',
  'debt_created',
  'debt_settled',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = ['auth_session', 'order', 'bill', 'bill_split', 'inventory_item', 'debt_ledger', 'user'] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export interface AuditActor {
  userId?: string;
  role?: string | string[];
}

export interface AuditEventRecord {
  id: string;
  action: AuditAction;
  actor: AuditActor;
  timestamp: string;
  entity: {
    type: AuditEntityType;
    id?: string;
    label?: string;
  };
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEventFilter {
  query?: string;
  action?: AuditAction;
  actorUserId?: string;
  entityType?: AuditEntityType;
  entityId?: string;
  from?: string;
  to?: string;
  reason?: string;
  hasReason?: boolean;
  limit?: number;
}

export interface AuditFilterOptions {
  actions: AuditAction[];
  entityTypes: AuditEntityType[];
}

const auditEvents: AuditEventRecord[] = [];

export async function appendAuditEvent(event: AuditEventRecord): Promise<AuditEventRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('audit:events', event.id, event);
  auditEvents.push(structuredClone(event));
  return structuredClone(event);
}

export async function listAuditEvents(filter: AuditEventFilter = {}): Promise<AuditEventRecord[]> {
  const query = filter.query?.trim().toLowerCase();
  const reasonQuery = filter.reason?.trim().toLowerCase();
  const limit = typeof filter.limit === 'number' ? Math.max(0, Math.floor(filter.limit)) : undefined;
  const sourceEvents = isSqlRepositoryEnabled() ? await listRecords<AuditEventRecord>('audit:events') : auditEvents;
  const rows = sourceEvents
    .filter((event) => {
      if (filter.action && event.action !== filter.action) return false;
      if (filter.actorUserId && event.actor.userId !== filter.actorUserId) return false;
      if (filter.entityType && event.entity.type !== filter.entityType) return false;
      if (filter.entityId && event.entity.id !== filter.entityId) return false;
      if (filter.from && event.timestamp < filter.from) return false;
      if (filter.to && event.timestamp > filter.to) return false;
      if (filter.hasReason === true && !event.reason) return false;
      if (filter.hasReason === false && event.reason) return false;
      if (reasonQuery && !event.reason?.toLowerCase().includes(reasonQuery)) return false;
      if (!query) return true;

      const searchable = [
        event.action,
        event.actor.userId,
        Array.isArray(event.actor.role) ? event.actor.role.join(',') : event.actor.role,
        event.entity.type,
        event.entity.id,
        event.entity.label,
        event.reason,
        JSON.stringify(event.metadata ?? {}),
        JSON.stringify(event.before ?? {}),
        JSON.stringify(event.after ?? {}),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(query);
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return rows.slice(0, limit).map((event) => structuredClone(event));
}

export async function getAuditFilterOptions(): Promise<AuditFilterOptions> {
  return {
    actions: [...AUDIT_ACTIONS],
    entityTypes: [...AUDIT_ENTITY_TYPES],
  };
}
