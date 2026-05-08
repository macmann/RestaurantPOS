import type { AuthenticatedUser } from '../../backend/auth/policies';
import { getLocaleResource } from '../../backend/i18n/service';
import { buildLocaleSwitchState } from '../i18n/locale-switcher';
import {
  createOrderDraft,
  editOrderBeforePayment,
  getOrder,
  transitionOrderStatus,
  type CreateOrderInput,
  type EditOrderInput,
} from '../../backend/orders/service';
import type { OrderStatus } from '../../backend/orders/repository';

export async function startDineInOrder(user: AuthenticatedUser, tableId: string, seed?: CreateOrderInput['items']) {
  return createOrderDraft(user, { serviceMode: 'dine_in', tableId, items: seed });
}

export async function startTakeoutOrder(user: AuthenticatedUser, customerName: string, seed?: CreateOrderInput['items']) {
  return createOrderDraft(user, { serviceMode: 'takeout', takeoutName: customerName, items: seed });
}

export async function updateOrderCart(user: AuthenticatedUser, orderId: string, edit: EditOrderInput) {
  return editOrderBeforePayment(user, orderId, edit);
}

export async function advanceOrderStatus(user: AuthenticatedUser, orderId: string, expectedVersion: number, nextStatus: OrderStatus) {
  return transitionOrderStatus(user, orderId, expectedVersion, nextStatus);
}

export async function loadOrderForScreen(orderId: string, locale?: string) {
  const resource = getLocaleResource(locale);
  return {
    title: resource.screens.orders,
    localeSwitch: buildLocaleSwitchState(resource.locale),
    order: await getOrder(orderId),
  };
}
