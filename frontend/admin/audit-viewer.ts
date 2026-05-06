import { AdminAuditApi } from '../../backend/audit/controller';
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
}

export interface AdminAuditViewerState {
  loading: boolean;
  filters: AdminAuditViewerFilters;
  events: AuditEventRecord[];
  error?: string;
}

export function defaultAuditViewerFilters(): AdminAuditViewerFilters {
  return {};
}

export async function loadAdminAuditViewer(
  user: AuthenticatedUser,
  filters: AdminAuditViewerFilters = defaultAuditViewerFilters(),
): Promise<AdminAuditViewerState> {
  try {
    const events = await AdminAuditApi.search(user, filters);
    return { loading: false, filters, events };
  } catch (error) {
    return {
      loading: false,
      filters,
      events: [],
      error: error instanceof Error ? error.message : 'Failed to load audit events.',
    };
  }
}

export function summarizeAuditEvent(event: AuditEventRecord): string {
  const actor = event.actor.userId ?? 'system';
  const entity = [event.entity.type, event.entity.id ?? event.entity.label].filter(Boolean).join(':');
  const reason = event.reason ? ` Reason: ${event.reason}` : '';
  return `${event.timestamp} — ${event.action} by ${actor} on ${entity}.${reason}`;
}
