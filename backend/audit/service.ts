import { can, type AuthenticatedUser } from '../auth/policies';
import { Actions } from '../auth/permissions';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  appendAuditEvent,
  getAuditFilterOptions,
  listAuditEvents,
  type AuditAction,
  type AuditEntityType,
  type AuditEventFilter,
  type AuditEventRecord,
  type AuditFilterOptions,
} from './repository';

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

export interface AuditSearchResult {
  events: AuditEventRecord[];
  filters: AuditSearchInput;
  availableFilters: AuditFilterOptions;
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function toActor(actor: RecordAuditEventInput['actor']): AuditEventRecord['actor'] {
  if (!actor) return {};
  if ('id' in actor) return { userId: actor.id, role: actor.role };
  return { userId: actor.userId, role: actor.role };
}

function assertKnownAction(action: AuditAction): void {
  if (!AUDIT_ACTIONS.includes(action)) throw new Error(`Unknown audit action: ${action}.`);
}

function assertKnownEntityType(entityType: AuditEntityType): void {
  if (!AUDIT_ENTITY_TYPES.includes(entityType)) throw new Error(`Unknown audit entity type: ${entityType}.`);
}

function normalizeSearchFilter(filter: AuditSearchInput): AuditSearchInput {
  if (filter.action) assertKnownAction(filter.action);
  if (filter.entityType) assertKnownEntityType(filter.entityType);
  if (filter.from && Number.isNaN(Date.parse(filter.from))) throw new Error('Invalid from timestamp.');
  if (filter.to && Number.isNaN(Date.parse(filter.to))) throw new Error('Invalid to timestamp.');
  if (filter.from && filter.to && filter.from > filter.to) throw new Error('from must be earlier than to.');

  return {
    ...filter,
    query: filter.query?.trim() || undefined,
    actorUserId: filter.actorUserId?.trim() || undefined,
    entityId: filter.entityId?.trim() || undefined,
    reason: filter.reason?.trim() || undefined,
    limit: filter.limit === undefined ? 100 : Math.min(Math.max(Math.floor(filter.limit), 1), 500),
  };
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<AuditEventRecord> {
  assertKnownAction(input.action);
  assertKnownEntityType(input.entity.type);

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

export async function searchAuditEvents(user: AuthenticatedUser, filter: AuditSearchInput = {}): Promise<AuditSearchResult> {
  if (!can(user, Actions.ViewAudit)) throw new Error('Forbidden: cannot view audit events.');
  const normalized = normalizeSearchFilter(filter);
  const [events, availableFilters] = await Promise.all([listAuditEvents(normalized), getAuditFilterOptions()]);
  return { events, filters: normalized, availableFilters };
}
