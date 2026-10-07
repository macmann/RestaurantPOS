import { withOperationalWrite } from '../db/operationalWrite';
import { Actions } from '../auth/permissions';
import { can, type AuthenticatedUser } from '../auth/policies';
import { getBillByTableSessionId, type BillRecord } from '../billing/repository';
import { getCurrentBranchId } from '../config/branch';
import { listOrders, updateOrderWithVersionCheck } from '../orders/repository';
import { assertBillEditable, transferUnpaidBill } from '../billing/service';
import { recordAuditEvent } from '../audit/service';
import { syncOrderIntoKds } from '../kds/service';
import { isSqlRepositoryEnabled, withTransaction } from '../db/client';
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
  layoutX?: number;
  layoutY?: number;
}

export interface UpdateTableInput {
  name?: string;
  capacity?: number;
  status?: DiningTableStatus;
  layoutX?: number;
  layoutY?: number;
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

function normalizeLayoutCoordinate(value: number | undefined, field: 'layoutX' | 'layoutY'): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${field} must be a number between 0 and 100.`);
  return Math.round(value);
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
    layoutX: normalizeLayoutCoordinate(input.layoutX, 'layoutX'),
    layoutY: normalizeLayoutCoordinate(input.layoutY, 'layoutY'),
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
  if (input.layoutX !== undefined) table.layoutX = normalizeLayoutCoordinate(input.layoutX, 'layoutX');
  if (input.layoutY !== undefined) table.layoutY = normalizeLayoutCoordinate(input.layoutY, 'layoutY');
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

async function openTableSessionImpl(user: AuthenticatedUser, input: { tableId: string; guestCount: number; branchId?: string }): Promise<TableSessionRecord> {
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
  const bill = await getBillByTableSessionId(tableSessionId);
  if (bill && !isBillComplete(bill)) throw new Error('Cannot close table session until every split is paid, void, or moved to debt.');
  if (linkedOrders.length && !bill) throw new Error('Cannot close table session until the linked bill is paid, void, or moved to debt.');
}

async function closeTableSessionImpl(user: AuthenticatedUser, tableSessionId: string): Promise<TableSessionRecord> {
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

async function transferTableSessionImpl(user: AuthenticatedUser, sourceSessionId: string, input: { destinationTableId: string; merge?: boolean }): Promise<TableSessionRecord> {
  assertCanManageTables(user);
  const initial = await requireOpenTableSession(sourceSessionId);
  const ids = [initial.tableId, input.destinationTableId].sort();
  if (ids[0] === ids[1]) throw new Error('Choose a different destination table.');
  return withTableSessionOpenLock(ids[0], () => withTableSessionOpenLock(ids[1], () => withTransaction(async client => {
    if (isSqlRepositoryEnabled()) for (const id of ids) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`table:${id}`]);
    const source = await requireOpenTableSession(sourceSessionId);
    const table = await getTableById(input.destinationTableId);
    if (!table || table.status !== 'active') throw new Error('Destination table must be active.');
    if (table.branchId !== source.branchId || (user.branchId && user.branchId !== source.branchId)) throw new Error('Forbidden: tables must belong to your branch.');
    let destination = (await listTableSessions({ branchId: source.branchId, tableId: table.id, status: 'open' }))[0];
    if (destination && input.merge !== true) throw new Error('Destination is occupied. Confirm merge to continue.');
    const beforeTransfer = { sourceSession: structuredClone(source), destinationSession: destination ? structuredClone(destination) : null };
    const sourceBill = await getBillByTableSessionId(source.id);
    const targetBill = destination ? await getBillByTableSessionId(destination.id) : null;
    assertBillEditable(sourceBill);
    assertBillEditable(targetBill);
    const allOrders = await listOrders();
    const movedOrders = allOrders.filter(order => order.tableSessionId === source.id);
    const now = new Date().toISOString();
    const targetId = destination?.id ?? createId('sess');
    destination = destination ? { ...destination, guestCount: destination.guestCount + source.guestCount, updatedAt: now } : {
      id: targetId, branchId: source.branchId, tableId: table.id, guestCount: source.guestCount,
      status: 'open', openedByUserId: user.id, openedAt: now, updatedAt: now,
    };
    const billItems = allOrders.filter(order => [source.id, targetId].includes(order.tableSessionId ?? '') && order.status !== 'cancelled').flatMap(order => order.items.map(item => ({
      id: item.id, orderId: order.id, tableSessionId: targetId, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice,
    })));
    // Validate before writing; PostgreSQL commits the entire move atomically.
    const changedOrders = [];
    for (const order of movedOrders) changedOrders.push(await updateOrderWithVersionCheck(order.id, order.version, draft => {
      draft.tableId = table.id; draft.tableName = table.name; draft.tableSessionId = targetId;
      draft.changeLog.push({ at: now, actorUserId: user.id, actorRole: String(user.role), action: 'table_transferred', details: { sourceSessionId: source.id, destinationSessionId: targetId, sourceTableId: source.tableId, destinationTableId: table.id } });
      return draft;
    }));
    await saveTableSession(destination);
    await transferUnpaidBill(source.id, targetId, table.name, billItems);
    source.status = 'closed'; source.closedAt = now; source.closedByUserId = user.id; source.updatedAt = now; source.transferredToSessionId = targetId;
    await saveTableSession(source);
    await recordAuditEvent({ action: 'table_transferred', actor: user, entity: { type: 'table_session', id: source.id }, before: { ...beforeTransfer, sourceBill, destinationBill: targetBill }, after: { sourceSession: source, destinationSession: destination, destinationBill: await getBillByTableSessionId(targetId) }, metadata: { sourceSessionId: source.id, destinationSessionId: targetId, merged: input.merge === true, orderIds: changedOrders.map(order => order.id) } });
    for (const order of changedOrders) await syncOrderIntoKds(order);
    return destination;
  })));
}

export const openTableSession = (...args: Parameters<typeof openTableSessionImpl>): ReturnType<typeof openTableSessionImpl> => withOperationalWrite(() => openTableSessionImpl(...args));

export const closeTableSession = (...args: Parameters<typeof closeTableSessionImpl>): ReturnType<typeof closeTableSessionImpl> => withOperationalWrite(() => closeTableSessionImpl(...args));

export const transferTableSession = (...args: Parameters<typeof transferTableSessionImpl>): ReturnType<typeof transferTableSessionImpl> => withOperationalWrite(() => transferTableSessionImpl(...args));
