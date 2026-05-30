import type { AuthenticatedUser } from '../../backend/auth/policies';
import { buildLocaleSwitchState, getLocaleResource } from '../i18n/locale-switcher';
import type { CreateOrderInput, EditOrderInput } from '../../backend/orders/service';
import { apiClient } from '../api/client';
import type { OrderStatus } from '../../backend/orders/repository';

export async function startDineInOrder(user: AuthenticatedUser, tableId: string, seed?: CreateOrderInput['items']) {
  return apiClient.createOrder(user.id, { serviceMode: 'dine_in', tableId, items: seed });
}

export async function startTakeoutOrder(user: AuthenticatedUser, customerName: string, seed?: CreateOrderInput['items']) {
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
