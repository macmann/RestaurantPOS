import { Actions } from '../auth/permissions';
import { can, type AuthenticatedUser } from '../auth/policies';
import { getBillByTableSessionId, type BillRecord } from '../billing/repository';
import { getCurrentBranchId } from '../config/branch';
import { listOrders } from '../orders/repository';
import {
  deleteTableById,
  getTableById,
  getTableSessionById,
  listTableSessions,
  listTables,
  saveTable,
  saveTableSession,
  type DiningTableRecord,
  type DiningTableStatus,
  type TableSessionRecord,
} from './repository';

export interface UpsertTableInput {
  id?: string;
  branchId?: string;
  name: string;
  capacity: number;
  status?: DiningTableStatus;
}

export interface UpdateTableInput {
  name?: string;
  capacity?: number;
  status?: DiningTableStatus;
}

export interface TableFloorState {
  table: DiningTableRecord;
  activeSession?: TableSessionRecord;
  status: 'available' | 'occupied' | 'inactive';
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const tableSessionOpenLocks = new Map<string, Promise<void>>();

async function withTableSessionOpenLock<T>(tableId: string, callback: () => Promise<T>): Promise<T> {
  const previous = tableSessionOpenLocks.get(tableId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  tableSessionOpenLocks.set(tableId, queued);

  await previous;
  try {
    return await callback();
  } finally {
    if (tableSessionOpenLocks.get(tableId) === queued) tableSessionOpenLocks.delete(tableId);
    release();
  }
}

function assertCanManageTables(user: AuthenticatedUser): void {
  if (!can(user, Actions.CreateOrder)) throw new Error('Forbidden: cannot manage table sessions.');
}

function normalizeGuestCount(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('guestCount must be a positive integer.');
  return value;
}

function normalizeCapacity(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('capacity must be a positive integer.');
  return value;
}

export async function createTable(input: UpsertTableInput): Promise<DiningTableRecord> {
  const now = new Date().toISOString();
  const name = input.name?.trim();
  if (!name) throw new Error('name is required.');
  return saveTable({
    id: input.id?.trim() || createId('tbl'),
    branchId: input.branchId ?? getCurrentBranchId(),
    name,
    capacity: normalizeCapacity(input.capacity),
    status: input.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateTable(tableId: string, input: UpdateTableInput): Promise<DiningTableRecord> {
  const table = await getTableById(tableId);
  if (!table) throw new Error('Table not found.');
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error('name is required.');
    table.name = name;
  }
  if (input.capacity !== undefined) table.capacity = normalizeCapacity(input.capacity);
  if (input.status !== undefined) table.status = input.status;
  table.updatedAt = new Date().toISOString();
  return saveTable(table);
}

export async function removeTable(tableId: string): Promise<{ deleted: boolean }> {
  const active = await listTableSessions({ tableId, status: 'open' });
  if (active.length) throw new Error('Cannot delete a table with an open session.');
  return { deleted: await deleteTableById(tableId) };
}

export async function listTableFloor(branchId = getCurrentBranchId()): Promise<TableFloorState[]> {
  const [tableRows, openSessions] = await Promise.all([listTables(branchId), listTableSessions({ branchId, status: 'open' })]);
  return tableRows.map((table) => {
    const activeSession = openSessions.find((session) => session.tableId === table.id);
    return {
      table,
      activeSession,
      status: table.status === 'inactive' ? 'inactive' : activeSession ? 'occupied' : 'available',
    };
  });
}

export async function openTableSession(user: AuthenticatedUser, input: { tableId: string; guestCount: number; branchId?: string }): Promise<TableSessionRecord> {
  assertCanManageTables(user);
  return withTableSessionOpenLock(input.tableId, async () => {
    const table = await getTableById(input.tableId);
    if (!table) throw new Error('Table not found.');
    if (table.status !== 'active') throw new Error('Cannot open a session for an inactive table.');
    const branchId = input.branchId ?? table.branchId ?? user.branchId ?? getCurrentBranchId();
    const existing = await listTableSessions({ branchId, tableId: input.tableId, status: 'open' });
    if (existing.length) throw new Error(`An active session already exists for table ${input.tableId}.`);
    const now = new Date().toISOString();
    return saveTableSession({
      id: createId('sess'),
      branchId,
      tableId: table.id,
      guestCount: normalizeGuestCount(input.guestCount),
      status: 'open',
      openedByUserId: user.id,
      openedAt: now,
      updatedAt: now,
    });
  });
}

function isBillComplete(bill: BillRecord | null): boolean {
  return !!bill && ['paid', 'void', 'debt'].includes(bill.state);
}

export async function assertTableSessionCanClose(tableSessionId: string): Promise<void> {
  const session = await getTableSessionById(tableSessionId);
  if (!session) throw new Error('Table session not found.');
  const linkedOrders = (await listOrders()).filter((order) => order.tableSessionId === tableSessionId);
  const incompleteOrder = linkedOrders.find((order) => !['delivered', 'cancelled'].includes(order.status));
  if (incompleteOrder) throw new Error(`Cannot close table session while order ${incompleteOrder.id} is ${incompleteOrder.status}.`);
  if (linkedOrders.length) {
    const bill = await getBillByTableSessionId(tableSessionId);
    if (!isBillComplete(bill)) throw new Error('Cannot close table session until the linked bill is paid, void, or moved to debt.');
  }
}

export async function closeTableSession(user: AuthenticatedUser, tableSessionId: string): Promise<TableSessionRecord> {
  assertCanManageTables(user);
  const session = await getTableSessionById(tableSessionId);
  if (!session) throw new Error('Table session not found.');
  if (session.status === 'closed') throw new Error('Table session is already closed.');
  await assertTableSessionCanClose(tableSessionId);
  const now = new Date().toISOString();
  session.status = 'closed';
  session.closedByUserId = user.id;
  session.closedAt = now;
  session.updatedAt = now;
  return saveTableSession(session);
}

export async function requireOpenTableSession(tableSessionId: string): Promise<TableSessionRecord> {
  const session = await getTableSessionById(tableSessionId);
  if (!session) throw new Error('Table session not found.');
  if (session.status !== 'open') throw new Error('Table session is not open.');
  return session;
}

export async function getTableSession(tableSessionId: string): Promise<TableSessionRecord | null> {
  return getTableSessionById(tableSessionId);
}

export async function listSessionsForTable(tableId: string): Promise<TableSessionRecord[]> {
  return listTableSessions({ tableId });
}
