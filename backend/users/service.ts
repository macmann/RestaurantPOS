import { recordAuditEvent } from '../audit/service';
import { getUserById, setUserStatus } from './repository';

export async function deactivateUser(userId: string) {
  return setUserStatus(userId, 'inactive');
}

export async function activateUser(userId: string) {
  return setUserStatus(userId, 'active');
}

export async function assertLoginAllowed(userId: string): Promise<void> {
  const user = await getUserById(userId);
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
