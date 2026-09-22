import { strict as assert } from 'node:assert';
import type { AuthenticatedUser } from '../backend/auth/policies';
import { updatePosOperationalSettings } from '../backend/config/posSettings';
import { createCategory, createItem } from '../backend/menu/repository';
import { createOrder } from '../backend/orders/repository';
import { getStationReport } from '../backend/reports/service';

async function run(): Promise<void> {
  process.env.POS_BRANCH_ID = 'station-report-test';
  updatePosOperationalSettings({ prepStations: [
    { id: 'kitchen', displayName: 'Kitchen', enabled: true, sortOrder: 10 },
    { id: 'bbq', displayName: 'BBQ', enabled: true, sortOrder: 20 },
  ] });
  const now = new Date().toISOString();
  await createCategory({ id: 'station-cat', branchId: 'station-report-test', name: 'Grill', sortOrder: 1, isActive: true, createdAt: now, updatedAt: now });
  await createItem({ id: 'station-menu-item', branchId: 'station-report-test', categoryId: 'station-cat', name: 'Skewer', price: 12, prepStation: 'kitchen', isAvailable: true, isActive: true, isPromotional: false, createdAt: now, updatedAt: now });
  await createOrder({ id: 'station-order', branchId: 'station-report-test', serviceMode: 'dine_in', status: 'delivered', items: [{ id: 'station-order-item', menuItemId: 'station-menu-item', name: 'Skewer', station: 'bbq', quantity: 2, unitPrice: 12, lineTotal: 24 }], subtotal: 24, version: 1, createdBy: 'waiter', createdAt: now, updatedAt: now, changeLog: [] });
  const manager: AuthenticatedUser = { id: 'station-manager', branchId: 'station-report-test', role: 'manager', status: 'active' };
  const report = await getStationReport(manager, { branchId: 'station-report-test', stationId: 'bbq', category: 'Grill' });
  assert(report.stations.some((station) => station.id === 'bbq'), 'A station added in settings must automatically be exposed as a report choice.');
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].stationId, 'bbq', 'Reporting must use the OrderItem station snapshot, not the current menu station.');
  assert.equal(report.rows[0].quantitySold, 2);
  assert.equal(report.rows[0].grossSales, 24);
  console.log('station report unit test passed');
}

void run();
