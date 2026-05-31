import { hashPassword } from '../auth/service';
import { getCurrentBranchId } from '../config/branch';
import { getUserRecordById, saveUser, type PublicUserProfile } from './repository';

export const DEFAULT_SUPERADMIN_ID = 'superadmin';
export const DEFAULT_SUPERADMIN_USERNAME = 'superadmin';
export const DEFAULT_SUPERADMIN_PASSWORD = 'password123';
export const DEFAULT_SUPERADMIN_ROLE = 'superadmin';

export async function ensureDefaultSuperadmin(): Promise<PublicUserProfile> {
  const existing = await getUserRecordById(DEFAULT_SUPERADMIN_ID);
  if (existing) return existing;

  return saveUser({
    id: DEFAULT_SUPERADMIN_ID,
    username: DEFAULT_SUPERADMIN_USERNAME,
    email: 'superadmin@sympos.local',
    passwordHash: hashPassword(DEFAULT_SUPERADMIN_PASSWORD),
    branchId: getCurrentBranchId(),
    role: DEFAULT_SUPERADMIN_ROLE,
    status: 'active',
  });
}
