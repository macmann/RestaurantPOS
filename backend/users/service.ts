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
    throw new Error('Invalid credentials.');
  }

  if (user.status !== 'active') {
    throw new Error('Account is inactive. Contact a manager.');
  }
}
