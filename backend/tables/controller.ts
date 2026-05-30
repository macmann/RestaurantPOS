import type { AuthenticatedUser } from '../auth/policies';
import { closeTableSession, createTable, getTableSession, listSessionsForTable, listTableFloor, openTableSession, removeTable, updateTable } from './service';

export const TablesApi = {
  listFloor: (branchId?: string) => listTableFloor(branchId),
  createTable,
  updateTable,
  removeTable,
  openSession: (user: AuthenticatedUser, input: { tableId: string; guestCount: number; branchId?: string }) => openTableSession(user, input),
  closeSession: (user: AuthenticatedUser, tableSessionId: string) => closeTableSession(user, tableSessionId),
  getSession: (tableSessionId: string) => getTableSession(tableSessionId),
  listSessionsForTable: (tableId: string) => listSessionsForTable(tableId),
};
