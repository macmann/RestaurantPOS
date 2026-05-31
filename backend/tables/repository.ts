import { isSqlRepositoryEnabled } from '../db/client';
import { deleteRecord, getRecord, listRecords, putRecord } from '../db/repositoryStore';

export type DiningTableStatus = 'active' | 'inactive';
export type TableSessionStatus = 'open' | 'closed';

export interface DiningTableRecord {
  id: string;
  branchId: string;
  name: string;
  capacity: number;
  status: DiningTableStatus;
  layoutX?: number;
  layoutY?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TableSessionRecord {
  id: string;
  branchId: string;
  tableId: string;
  guestCount: number;
  status: TableSessionStatus;
  openedByUserId: string;
  openedAt: string;
  closedByUserId?: string;
  closedAt?: string;
  updatedAt: string;
}

const tables = new Map<string, DiningTableRecord>();
const sessions = new Map<string, TableSessionRecord>();

export async function saveTable(table: DiningTableRecord): Promise<DiningTableRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('tables', table.id, table);
  tables.set(table.id, structuredClone(table));
  return structuredClone(table);
}

export async function getTableById(tableId: string): Promise<DiningTableRecord | null> {
  if (isSqlRepositoryEnabled()) return getRecord<DiningTableRecord>('tables', tableId);
  const found = tables.get(tableId);
  return found ? structuredClone(found) : null;
}

export async function listTables(branchId?: string): Promise<DiningTableRecord[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<DiningTableRecord>('tables') : [...tables.values()].map((table) => structuredClone(table));
  return rows.filter((table) => !branchId || table.branchId === branchId).sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteTableById(tableId: string): Promise<boolean> {
  if (isSqlRepositoryEnabled()) return deleteRecord('tables', tableId);
  return tables.delete(tableId);
}

export async function saveTableSession(session: TableSessionRecord): Promise<TableSessionRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('table:sessions', session.id, session);
  sessions.set(session.id, structuredClone(session));
  return structuredClone(session);
}

export async function getTableSessionById(tableSessionId: string): Promise<TableSessionRecord | null> {
  if (isSqlRepositoryEnabled()) return getRecord<TableSessionRecord>('table:sessions', tableSessionId);
  const found = sessions.get(tableSessionId);
  return found ? structuredClone(found) : null;
}

export async function listTableSessions(filter: { branchId?: string; tableId?: string; status?: TableSessionStatus } = {}): Promise<TableSessionRecord[]> {
  const rows = isSqlRepositoryEnabled() ? await listRecords<TableSessionRecord>('table:sessions') : [...sessions.values()].map((session) => structuredClone(session));
  return rows
    .filter((session) => !filter.branchId || session.branchId === filter.branchId)
    .filter((session) => !filter.tableId || session.tableId === filter.tableId)
    .filter((session) => !filter.status || session.status === filter.status)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}
