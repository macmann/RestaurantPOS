import type { AuthenticatedUser } from '../../backend/auth/policies';
import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';
import type { EditOrderInput, OrderMenuItemInput } from '../../backend/orders/service';
import { apiClient } from '../api/client';
import type { OrderStatus } from '../../backend/orders/repository';

export type OrderScreenItemSelection = Pick<OrderMenuItemInput, 'menuItemId' | 'quantity' | 'note' | 'modifiers' | 'allowUnavailableOverride' | 'overrideReason'>;

export async function startDineInOrder(user: AuthenticatedUser, tableSessionId: string, seed?: OrderScreenItemSelection[]) {
  return apiClient.createOrder(user.id, { serviceMode: 'dine_in', tableSessionId, items: seed });
}

export async function startTakeoutOrder(user: AuthenticatedUser, customerName: string, seed?: OrderScreenItemSelection[]) {
  return apiClient.createOrder(user.id, { serviceMode: 'takeout', takeoutName: customerName, items: seed });
}

export async function updateOrderCart(user: AuthenticatedUser, orderId: string, edit: EditOrderInput) {
  return apiClient.editOrder(user.id, orderId, edit);
}

export async function advanceOrderStatus(user: AuthenticatedUser, orderId: string, expectedVersion: number, nextStatus: OrderStatus) {
  return apiClient.transitionOrderStatus(user.id, orderId, expectedVersion, nextStatus);
}

export async function loadOrderForScreen(orderId: string, locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    title: resource.screens.orders,
    localeSwitch: buildLocaleSwitchState(resource.locale),
    order: await apiClient.getOrder(orderId),
  };
}
