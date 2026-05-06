export type AuditAction =
  | 'login_succeeded'
  | 'login_failed'
  | 'order_edited'
  | 'order_cancelled'
  | 'bill_voided'
  | 'stock_adjusted'
  | 'tax_toggled'
  | 'discount_applied'
  | 'debt_created'
  | 'debt_settled';

export type AuditEntityType = 'auth_session' | 'order' | 'bill' | 'bill_split' | 'inventory_item' | 'debt_ledger' | 'user';

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
}

const auditEvents: AuditEventRecord[] = [];

export async function appendAuditEvent(event: AuditEventRecord): Promise<AuditEventRecord> {
  auditEvents.push(structuredClone(event));
  return structuredClone(event);
}

export async function listAuditEvents(filter: AuditEventFilter = {}): Promise<AuditEventRecord[]> {
  const query = filter.query?.trim().toLowerCase();
  return auditEvents
    .filter((event) => {
      if (filter.action && event.action !== filter.action) return false;
      if (filter.actorUserId && event.actor.userId !== filter.actorUserId) return false;
      if (filter.entityType && event.entity.type !== filter.entityType) return false;
      if (filter.entityId && event.entity.id !== filter.entityId) return false;
      if (filter.from && event.timestamp < filter.from) return false;
      if (filter.to && event.timestamp > filter.to) return false;
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
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .map((event) => structuredClone(event));
}
