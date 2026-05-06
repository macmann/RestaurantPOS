import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import { appendAuditEvent, listAuditEvents, type AuditAction, type AuditEntityType, type AuditEventFilter, type AuditEventRecord } from './repository';

export interface RecordAuditEventInput {
  action: AuditAction;
  actor?: AuthenticatedUser | { userId?: string; role?: string | string[] };
  timestamp?: string;
  entity: AuditEventRecord['entity'];
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditSearchInput extends AuditEventFilter {
  action?: AuditAction;
  entityType?: AuditEntityType;
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function toActor(actor: RecordAuditEventInput['actor']): AuditEventRecord['actor'] {
  if (!actor) return {};
  if ('id' in actor) return { userId: actor.id, role: actor.role };
  return { userId: actor.userId, role: actor.role };
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<AuditEventRecord> {
  return appendAuditEvent({
    id: createId('audit'),
    action: input.action,
    actor: toActor(input.actor),
    timestamp: input.timestamp ?? new Date().toISOString(),
    entity: input.entity,
    before: input.before === undefined ? undefined : structuredClone(input.before),
    after: input.after === undefined ? undefined : structuredClone(input.after),
    reason: input.reason?.trim() || undefined,
    metadata: input.metadata ? structuredClone(input.metadata) : undefined,
  });
}

export async function searchAuditEvents(user: AuthenticatedUser, filter: AuditSearchInput = {}): Promise<AuditEventRecord[]> {
  if (!can(user, Actions.ViewAudit)) throw new Error('Forbidden: cannot view audit events.');
  return listAuditEvents(filter);
}
