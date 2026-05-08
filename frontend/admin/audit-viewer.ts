import { AdminAuditApi } from '../../backend/audit/controller';
import { getLocaleResource } from '../../backend/i18n/service';
import { buildLocaleSwitchState } from '../i18n/locale-switcher';
import type { AuthenticatedUser } from '../../backend/auth/policies';
import type { AuditAction, AuditEntityType, AuditEventRecord } from '../../backend/audit/repository';

export interface AdminAuditViewerFilters {
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
  locale?: string;
}

export interface AuditFilterControl {
  name: keyof AdminAuditViewerFilters;
  label: string;
  type: 'search' | 'select' | 'datetime' | 'number' | 'toggle';
  value?: string | number | boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface AdminAuditViewerRow {
  id: string;
  timestamp: string;
  action: AuditAction;
  actor: string;
  entity: string;
  reason?: string;
  beforeSnapshot: string;
  afterSnapshot: string;
  summary: string;
}

export interface AdminAuditViewerState {
  loading: boolean;
  title: string;
  filters: AdminAuditViewerFilters;
  filterControls: AuditFilterControl[];
  events: AuditEventRecord[];
  rows: AdminAuditViewerRow[];
  emptyState: string;
  error?: string;
  localeSwitch: ReturnType<typeof buildLocaleSwitchState>;
}

export function defaultAuditViewerFilters(): AdminAuditViewerFilters {
  return { limit: 100 };
}

function formatActor(event: AuditEventRecord): string {
  const role = Array.isArray(event.actor.role) ? event.actor.role.join(', ') : event.actor.role;
  return [event.actor.userId ?? 'system', role ? `(${role})` : undefined].filter(Boolean).join(' ');
}

function formatEntity(event: AuditEventRecord): string {
  return [event.entity.type, event.entity.id ?? event.entity.label].filter(Boolean).join(':');
}

function snapshotPreview(value: unknown): string {
  if (value === undefined) return '—';
  return JSON.stringify(value, null, 2);
}

function toTitleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildFilterControls(
  filters: AdminAuditViewerFilters,
  actions: AuditAction[],
  entityTypes: AuditEntityType[],
): AuditFilterControl[] {
  return [
    { name: 'query', label: 'Search', type: 'search', value: filters.query, placeholder: 'Actor, entity, action, reason, or snapshot text' },
    { name: 'action', label: 'Action', type: 'select', value: filters.action, options: actions.map((action) => ({ value: action, label: toTitleCase(action) })) },
    { name: 'actorUserId', label: 'Actor', type: 'search', value: filters.actorUserId, placeholder: 'User ID' },
    { name: 'entityType', label: 'Entity type', type: 'select', value: filters.entityType, options: entityTypes.map((type) => ({ value: type, label: toTitleCase(type) })) },
    { name: 'entityId', label: 'Entity ID', type: 'search', value: filters.entityId, placeholder: 'Order, bill, inventory, or debt ID' },
    { name: 'reason', label: 'Reason', type: 'search', value: filters.reason, placeholder: 'Reason text' },
    { name: 'hasReason', label: 'Has reason', type: 'toggle', value: filters.hasReason },
    { name: 'from', label: 'From', type: 'datetime', value: filters.from },
    { name: 'to', label: 'To', type: 'datetime', value: filters.to },
    { name: 'limit', label: 'Limit', type: 'number', value: filters.limit ?? 100 },
  ];
}

function buildRows(events: AuditEventRecord[]): AdminAuditViewerRow[] {
  return events.map((event) => ({
    id: event.id,
    timestamp: event.timestamp,
    action: event.action,
    actor: formatActor(event),
    entity: formatEntity(event),
    reason: event.reason,
    beforeSnapshot: snapshotPreview(event.before),
    afterSnapshot: snapshotPreview(event.after),
    summary: summarizeAuditEvent(event),
  }));
}

export async function loadAdminAuditViewer(
  user: AuthenticatedUser,
  filters: AdminAuditViewerFilters = defaultAuditViewerFilters(),
): Promise<AdminAuditViewerState> {
  const resource = getLocaleResource(filters.locale);
  try {
    const result = await AdminAuditApi.search(user, filters);
    const rows = buildRows(result.events);
    return {
      loading: false,
      title: resource.screens.audit_viewer,
      filters: result.filters,
      filterControls: buildFilterControls(result.filters, result.availableFilters.actions, result.availableFilters.entityTypes),
      events: result.events,
      rows,
      emptyState: rows.length === 0 ? 'No audit events match the selected filters.' : '',
      localeSwitch: buildLocaleSwitchState(resource.locale),
    };
  } catch (error) {
    return {
      loading: false,
      title: resource.screens.audit_viewer,
      filters,
      filterControls: buildFilterControls(filters, [], []),
      events: [],
      rows: [],
      emptyState: 'No audit events match the selected filters.',
      localeSwitch: buildLocaleSwitchState(resource.locale),
      error: error instanceof Error ? error.message : 'Failed to load audit events.',
    };
  }
}

export function summarizeAuditEvent(event: AuditEventRecord): string {
  const actor = formatActor(event);
  const entity = formatEntity(event);
  const reason = event.reason ? ` Reason: ${event.reason}` : '';
  return `${event.timestamp} — ${toTitleCase(event.action)} by ${actor} on ${entity}.${reason}`;
}
