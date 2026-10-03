import type { AuthenticatedUser } from '../auth/policies';
import {
  appendStockMovement,
  createInventoryMasterItem,
  getDeductionTriggerPolicy,
  listInventoryWithBalances,
  listLowStockAlerts,
  setDeductionTriggerPolicy,
  type DeductionTriggerPolicy,
  type InventoryItemInput,
  type StockMovementInput,
} from './service';

export const InventoryAdminApi = {
  createItem: (input: InventoryItemInput) => createInventoryMasterItem(input),
  listItems: (branchId?: string) => listInventoryWithBalances(branchId),
  addMovement: (input: StockMovementInput, actorUserId?: string) => appendStockMovement(input, actorUserId),
  listAlerts: (branchId?: string) => listLowStockAlerts(branchId),
  getDeductionPolicy: () => getDeductionTriggerPolicy(),
  setDeductionPolicy: (user: AuthenticatedUser, policy: DeductionTriggerPolicy) => setDeductionTriggerPolicy(user, policy),
};
