declare const process: { exitCode?: number };

import type { AuthenticatedUser } from '../backend/auth/policies';
import { adminCreateCategory, adminCreateItem } from '../backend/menu/service';
import { createOrderDraft, editOrderBeforePayment } from '../backend/orders/service';
import { saveUser } from '../backend/users/repository';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
}

async function assertRejects(action: () => Promise<unknown>, expectedMessage: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(String(error).includes(expectedMessage), `Expected rejection containing "${expectedMessage}", received ${String(error)}.`);
    return;
  }
  throw new Error(`Expected rejection containing "${expectedMessage}".`);
}

async function runAuthoritativeMenuUnitTests(): Promise<void> {
  const branchId = 'unit-authoritative-main';
  const waiter: AuthenticatedUser = { id: 'waiter-authoritative-unit', branchId, role: 'waitstaff', status: 'active' };
  const manager: AuthenticatedUser = { id: 'manager-authoritative-unit', branchId, role: 'manager', status: 'active' };
  await Promise.all([saveUser(waiter), saveUser(manager)]);

  const category = await adminCreateCategory({ branchId, name: 'Unit Authoritative Menu', sortOrder: 1 });
  const menuItem = await adminCreateItem({
    branchId,
    categoryId: category.id,
    name: 'Authoritative Noodles',
    price: 12.25,
    prepStation: 'bar',
    taxMode: 'taxable',
    taxRate: 8.75,
    isAvailable: true,
  });

  const staleCreate = await createOrderDraft(waiter, {
    branchId,
    serviceMode: 'takeout',
    takeoutName: 'Stale Create',
    items: [{ menuItemId: menuItem.id, quantity: 2, name: 'Wrong', unitPrice: 0.5, station: 'kitchen' } as any],
  });
  assertEqual(staleCreate.items[0].name, menuItem.name, 'Create should derive item name from menu');
  assertEqual(staleCreate.items[0].unitPrice, menuItem.price, 'Create should derive unit price from menu');
  assertEqual(staleCreate.items[0].station, 'bar', 'Create should derive prep station from menu');
  assertEqual(staleCreate.items[0].taxRate, 8.75, 'Create should derive tax metadata from menu');
  assertEqual(staleCreate.subtotal, 24.5, 'Create should calculate subtotal from menu price');

  const unavailableItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Unit Sold Out', price: 3.5, isAvailable: false });
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Unavailable', items: [{ menuItemId: unavailableItem.id, quantity: 1 }] }),
    'is unavailable',
  );
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Unauthorized Override', items: [{ menuItemId: unavailableItem.id, quantity: 1, allowUnavailableOverride: true, overrideReason: 'Please' }] }),
    'requires menu management permission',
  );
  const override = await createOrderDraft(manager, {
    branchId,
    serviceMode: 'takeout',
    takeoutName: 'Authorized Override',
    items: [{ menuItemId: unavailableItem.id, quantity: 2, allowUnavailableOverride: true, overrideReason: 'Manager-approved last serving' }],
  });
  assertEqual(override.subtotal, 7, 'Authorized override should add unavailable item at authoritative menu price');

  const inactiveMenuItem = await adminCreateItem({ branchId, categoryId: category.id, name: 'Unit Inactive Item', price: 4.25, isActive: false, isAvailable: true });
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Inactive Item', items: [{ menuItemId: inactiveMenuItem.id, quantity: 1 }] }),
    'is inactive',
  );

  const inactiveCategory = await adminCreateCategory({ branchId, name: 'Unit Inactive Category', sortOrder: 2, isActive: false });
  const inactiveItem = await adminCreateItem({ branchId, categoryId: inactiveCategory.id, name: 'Unit Inactive Dessert', price: 5, isAvailable: true });
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Inactive', items: [{ menuItemId: inactiveItem.id, quantity: 1 }] }),
    'is inactive',
  );

  const otherCategory = await adminCreateCategory({ branchId: 'unit-authoritative-other', name: 'Unit Other Branch', sortOrder: 1 });
  const otherItem = await adminCreateItem({ branchId: 'unit-authoritative-other', categoryId: otherCategory.id, name: 'Other Branch Dish', price: 9, isAvailable: true });
  await assertRejects(
    () => createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Mismatch', items: [{ menuItemId: otherItem.id, quantity: 1 }] }),
    'Branch mismatch',
  );

  const emptyOrder = await createOrderDraft(waiter, { branchId, serviceMode: 'takeout', takeoutName: 'Edit Add' });
  const edited = await editOrderBeforePayment(waiter, emptyOrder.id, {
    expectedVersion: emptyOrder.version,
    addItems: [{ menuItemId: menuItem.id, quantity: 1, name: 'Edited Wrong', unitPrice: 0.01 } as any],
  });
  assertEqual(edited.items[0].name, menuItem.name, 'Edit add should derive item name from menu');
  assertEqual(edited.items[0].unitPrice, menuItem.price, 'Edit add should derive stale price from menu');
}

runAuthoritativeMenuUnitTests()
  .then(() => {
    console.log('Authoritative menu order unit tests completed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
