import { recordAuditEvent } from '../audit/service';
import { Actions, type UserStatus } from '../auth/permissions';
import { can, type AuthenticatedUser } from '../auth/policies';
import { hashPassword } from '../auth/service';
import { revokeUserSessions } from '../auth/sessionRepository';
import { getUserRecordById, saveUser, setUserStatus, type PublicUserProfile } from './repository';

export interface StaffProfileInput {
  id?: string;
  username: string;
  email?: string;
  password?: string;
  role: string | string[];
  branchId?: string;
  status?: UserStatus;
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function assertCanManageStaff(actor: AuthenticatedUser): void {
  if (!can(actor, Actions.ManageStaff)) throw new Error('Forbidden: cannot manage staff profiles.');
}

function sanitizeInput(input: StaffProfileInput): StaffProfileInput {
  const username = input.username?.trim();
  if (!username) throw new Error('username is required.');
  const roles = Array.isArray(input.role) ? input.role.map((role) => role.trim()).filter(Boolean) : input.role?.trim();
  if (!roles || (Array.isArray(roles) && !roles.length)) throw new Error('role is required.');
  const status = input.status ?? 'active';
  if (!['active', 'inactive'].includes(status)) throw new Error('status must be active or inactive.');
  return {
    ...input,
    username,
    email: input.email?.trim() || undefined,
    role: roles,
    branchId: input.branchId?.trim() || undefined,
    status,
  };
}

export async function createStaffProfile(actor: AuthenticatedUser, input: StaffProfileInput): Promise<PublicUserProfile> {
  assertCanManageStaff(actor);
  const normalized = sanitizeInput(input);
  if (!normalized.password || normalized.password.length < 8) throw new Error('password must be at least 8 characters.');
  const id = normalized.id?.trim() || createId('user');
  if (await getUserRecordById(id)) throw new Error('User already exists.');

  const created = await saveUser({
    id,
    username: normalized.username,
    email: normalized.email,
    passwordHash: hashPassword(normalized.password),
    branchId: normalized.branchId,
    role: normalized.role,
    status: normalized.status ?? 'active',
  });

  await recordAuditEvent({
    action: 'user_created',
    actor,
    entity: { type: 'user', id: created.id, label: created.username },
    after: created,
    reason: 'Staff profile created.',
  });

  return created;
}

export async function updateStaffProfile(actor: AuthenticatedUser, userId: string, input: Partial<StaffProfileInput>): Promise<PublicUserProfile> {
  assertCanManageStaff(actor);
  const existing = await getUserRecordById(userId);
  if (!existing) throw new Error('User not found.');

  const updatedStatus = input.status ?? existing.status;
  if (!['active', 'inactive'].includes(updatedStatus)) throw new Error('status must be active or inactive.');
  const next = {
    ...existing,
    username: input.username?.trim() || existing.username,
    email: input.email === undefined ? existing.email : input.email?.trim() || undefined,
    branchId: input.branchId === undefined ? existing.branchId : input.branchId?.trim() || undefined,
    role: input.role === undefined ? existing.role : Array.isArray(input.role) ? input.role.map((role) => role.trim()).filter(Boolean) : input.role.trim(),
    status: updatedStatus,
    passwordHash: input.password ? hashPassword(input.password) : existing.passwordHash,
  };

  if (!next.username) throw new Error('username is required.');
  if (!next.role || (Array.isArray(next.role) && !next.role.length)) throw new Error('role is required.');
  if (input.password !== undefined && input.password.length < 8) throw new Error('password must be at least 8 characters.');

  const saved = await saveUser(next);
  if (existing.status === 'active' && saved.status !== 'active') await revokeUserSessions(userId, 'user_deactivated');
  if (input.password) await revokeUserSessions(userId, 'password_changed');

  await recordAuditEvent({
    action: input.password ? 'password_changed' : 'user_updated',
    actor,
    entity: { type: 'user', id: saved.id, label: saved.username },
    before: { ...existing, passwordHash: undefined },
    after: saved,
    reason: input.password ? 'Staff password changed.' : 'Staff profile updated.',
  });

  if (existing.status !== saved.status) {
    await recordAuditEvent({
      action: saved.status === 'active' ? 'user_activated' : 'user_deactivated',
      actor,
      entity: { type: 'user', id: saved.id, label: saved.username },
      before: { status: existing.status },
      after: { status: saved.status },
      reason: `Staff profile ${saved.status}.`,
    });
  }

  return saved;
}

export async function deactivateUser(userId: string, actor?: AuthenticatedUser) {
  const before = await getUserRecordById(userId);
  const updated = await setUserStatus(userId, 'inactive');
  if (updated) {
    await revokeUserSessions(userId, 'user_deactivated');
    if (actor) {
      await recordAuditEvent({
        action: 'user_deactivated',
        actor,
        entity: { type: 'user', id: updated.id, label: updated.username },
        before: before ? { status: before.status } : undefined,
        after: { status: updated.status },
        reason: 'Staff profile deactivated.',
      });
    }
  }
  return updated;
}

export async function activateUser(userId: string, actor?: AuthenticatedUser) {
  const before = await getUserRecordById(userId);
  const updated = await setUserStatus(userId, 'active');
  if (updated && actor) {
    await recordAuditEvent({
      action: 'user_activated',
      actor,
      entity: { type: 'user', id: updated.id, label: updated.username },
      before: before ? { status: before.status } : undefined,
      after: { status: updated.status },
      reason: 'Staff profile activated.',
    });
  }
  return updated;
}

export async function assertLoginAllowed(userId: string): Promise<void> {
  const user = await getUserRecordById(userId);
  if (!user) {
    await recordAuditEvent({
      action: 'login_failed',
      actor: { userId },
      entity: { type: 'auth_session', label: 'login' },
      reason: 'Invalid credentials.',
      metadata: { attemptedUserId: userId },
    });
    throw new Error('Invalid credentials.');
  }

  if (user.status !== 'active') {
    await recordAuditEvent({
      action: 'login_failed',
      actor: user,
      entity: { type: 'user', id: user.id, label: 'login' },
      before: { status: user.status },
      reason: 'Inactive account.',
    });
    throw new Error('Account is inactive. Contact a manager.');
  }

  await recordAuditEvent({
    action: 'login_succeeded',
    actor: user,
    entity: { type: 'user', id: user.id, label: 'login' },
    after: { status: user.status, role: user.role },
  });
}
