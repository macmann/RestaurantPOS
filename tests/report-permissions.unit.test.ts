import assert from 'node:assert/strict';
import { Actions, RolePermissions } from '../backend/auth/permissions';
import { can, type AuthenticatedUser } from '../backend/auth/policies';

const user = (role: string): AuthenticatedUser => ({ id: role, role, status: 'active' });
assert.equal(can(user('financial_analyst'), Actions.ViewFinancialReports), true);
assert.equal(can(user('financial_analyst'), Actions.ViewEmployeePerformanceReports), false);
assert.equal(can(user('operations_analyst'), Actions.ViewEmployeePerformanceReports), true);
assert.equal(can(user('loss_prevention'), Actions.ViewVoidReports), true);
assert.equal(can(user('inventory_accountant'), Actions.ViewInventoryCostReports), true);
assert.equal(RolePermissions.manager.includes(Actions.ViewFinancialReports), true);
console.log('report permission unit tests passed');
