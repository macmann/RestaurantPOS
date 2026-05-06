import type { AuthenticatedUser } from '../auth/policies';
import { searchAuditEvents, type AuditSearchInput } from './service';

export const AdminAuditApi = {
  search: (user: AuthenticatedUser, filters: AuditSearchInput = {}) => searchAuditEvents(user, filters),
};
