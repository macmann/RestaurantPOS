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
  listItems: () => listInventoryWithBalances(),
  addMovement: (input: StockMovementInput, actorUserId?: string) => appendStockMovement(input, actorUserId),
  listAlerts: () => listLowStockAlerts(),
  getDeductionPolicy: () => getDeductionTriggerPolicy(),
  setDeductionPolicy: (user: AuthenticatedUser, policy: DeductionTriggerPolicy) => setDeductionTriggerPolicy(user, policy),
};
