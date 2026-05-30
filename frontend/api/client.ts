import type { AuthenticatedUser } from '../../backend/auth/policies';
import type { Action } from '../../backend/auth/permissions';
import type { CreateOrderInput, EditOrderInput } from '../../backend/orders/service';
import type { OrderRecord, OrderStatus } from '../../backend/orders/repository';
import type { BillPricingOptions, BillPromotion, SplitLabel, TableOrderItem } from '../../backend/billing/repository';
import type { getBillCalculationBreakdown, getPrintedReceiptPayload } from '../../backend/billing/service';
import type { AdminMenuApi } from '../../backend/menu/controller';
import type { InventoryAdminApi } from '../../backend/inventory/controller';
import type { AdminAuditApi } from '../../backend/audit/controller';
import type { Station, KdsProgress } from '../../backend/kds/repository';
import type { KdsEvent, KdsSnapshot } from '../../backend/kds/service';
import type { TableFloorState } from '../../backend/tables/service';
import type { TableSessionRecord } from '../../backend/tables/repository';
import type { AdminAuditViewerFilters } from '../admin/audit-viewer';

type BillBreakdown = Awaited<ReturnType<typeof getBillCalculationBreakdown>>;
type ReceiptPayload = Awaited<ReturnType<typeof getPrintedReceiptPayload>>;
type MenuCategories = Awaited<ReturnType<typeof AdminMenuApi.list>>;
type InventoryAlerts = Awaited<ReturnType<typeof InventoryAdminApi.listAlerts>>;
type InventoryDeductionPolicy = Awaited<ReturnType<typeof InventoryAdminApi.getDeductionPolicy>>;
type AuditSearchResult = Awaited<ReturnType<typeof AdminAuditApi.search>>;

declare global {
  // Optional deploy-time override, for example when the API is hosted on another origin.
  // eslint-disable-next-line no-var
  var __RESTAURANT_POS_API_BASE__: string | undefined;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorBody {
  error?: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface LoginResponse {
  user: AuthenticatedUser;
  permissions: Action[];
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  userId?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function apiBase(): string {
  const configured = globalThis.__RESTAURANT_POS_API_BASE__;
  return configured && configured.trim() ? configured.replace(/\/$/, '') : '';
}

function queryString(query?: Record<string, unknown>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : undefined;

  if (!response.ok) {
    const body = (payload ?? {}) as ApiErrorBody;
    throw new ApiClientError(body.error ?? `Request failed with status ${response.status}.`, response.status, body.details);
  }

  return ((payload as ApiEnvelope<T> | undefined)?.data ?? payload) as T;
}


async function backendModule<T = any>(specifier: string): Promise<T> {
  return new Function('specifier', 'return import(specifier)')(specifier) as Promise<T>;
}

async function userFor(userId?: string) {
  if (!userId) throw new ApiClientError('Authentication required.', 401);
  const users = await backendModule<any>('../../backend/users/repository.js');
  const user = await users.getUserById(userId);
  if (!user) throw new ApiClientError('Authentication required.', 401);
  return user;
}

async function requestInProcess<T>(path: string, method: string, body: unknown, userId?: string): Promise<T> {
  const url = new URL(path, 'http://local');
  const parts = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/auth/login') {
    const users = await backendModule<any>('../../backend/users/repository.js');
    const service = await backendModule<any>('../../backend/users/service.js');
    const permissions = await backendModule<any>('../../backend/auth/permissions.js');
    const loginBody = body as { userId?: string };
    await service.assertLoginAllowed(loginBody.userId);
    const user = await users.getUserById(loginBody.userId);
    const roles = Array.isArray(user.role) ? user.role : [user.role];
    return { user, permissions: Array.from(new Set(roles.flatMap((role: string) => permissions.RolePermissions[role] ?? []))).sort() } as T;
  }

  if (parts[0] !== 'api') throw new ApiClientError('Route not found.', 404);


  if (parts[1] === 'tables') {
    const { TablesApi } = await backendModule<any>('../../backend/tables/controller.js');
    if (parts.length === 2 && method === 'GET') return TablesApi.listFloor(url.searchParams.get('branchId') ?? undefined) as Promise<T>;
    if (parts.length === 2 && method === 'POST') return TablesApi.createTable(body) as Promise<T>;
    if (parts.length === 3 && method === 'PATCH') return TablesApi.updateTable(parts[2], body) as Promise<T>;
    if (parts.length === 3 && method === 'DELETE') return TablesApi.removeTable(parts[2]) as Promise<T>;
    if (parts.length === 4 && parts[3] === 'sessions' && method === 'GET') return TablesApi.listSessionsForTable(parts[2]) as Promise<T>;
    if (parts.length === 4 && parts[3] === 'sessions' && method === 'POST') return TablesApi.openSession(await userFor(userId), { ...(body as object), tableId: parts[2] }) as Promise<T>;
    if (parts.length === 4 && parts[2] === 'sessions' && method === 'GET') return TablesApi.getSession(parts[3]) as Promise<T>;
    if (parts.length === 5 && parts[2] === 'sessions' && parts[4] === 'close' && method === 'POST') return TablesApi.closeSession(await userFor(userId), parts[3]) as Promise<T>;
  }

  if (parts[1] === 'orders') {
    const service = await backendModule<any>('../../backend/orders/service.js');
    const repository = await backendModule<any>('../../backend/orders/repository.js');
    if (parts.length === 2 && method === 'GET') return repository.listOrders() as Promise<T>;
    if (parts.length === 2 && method === 'POST') return service.createOrderDraft(await userFor(userId), body) as Promise<T>;
    if (parts.length === 3 && method === 'GET') return service.getOrder(parts[2]) as Promise<T>;
    if (parts.length === 3 && method === 'PATCH') return service.editOrderBeforePayment(await userFor(userId), parts[2], body) as Promise<T>;
    if (parts.length === 4 && parts[3] === 'status') {
      const statusBody = body as { expectedVersion: number; nextStatus: string };
      return service.transitionOrderStatus(await userFor(userId), parts[2], statusBody.expectedVersion, statusBody.nextStatus) as Promise<T>;
    }
  }

  if (parts[1] === 'kds') {
    const controller = await backendModule<any>('../../backend/kds/controller.js');
    if (parts.length === 2 && method === 'GET') return controller.listStationQueue(url.searchParams.get('station') ?? undefined) as Promise<T>;
    if (parts.length === 6 && parts[2] === 'orders' && parts[4] === 'items') {
      return controller.patchItemProgress(await userFor(userId), parts[3], parts[5], (body as { progress: string }).progress) as Promise<T>;
    }
  }

  if (parts[1] === 'billing' && parts[2] === 'bills') {
    const billing = await backendModule<any>('../../backend/billing/service.js');
    const tableSessionId = parts[3];
    if (parts.length === 3 && method === 'POST') {
      const input = body as { tableSessionId: string; itemsBySplit: unknown; pricing?: unknown };
      return billing.generateBillFromSessionItems(input.tableSessionId, input.itemsBySplit ?? {}, userId, input.pricing) as Promise<T>;
    }
    if (parts[4] === 'breakdown') return billing.getBillCalculationBreakdown(tableSessionId) as Promise<T>;
    if (parts[4] === 'receipt') return billing.getPrintedReceiptPayload(tableSessionId, url.searchParams.get('locale') ?? undefined) as Promise<T>;
    if (parts[4] === 'tax') return billing.setBillTaxMode({ ...(body as object), tableSessionId, actorUserId: userId }) as Promise<T>;
    if (parts[4] === 'promotions') return billing.applyBillPromotions({ ...(body as object), tableSessionId, actorUserId: userId }) as Promise<T>;
  }

  if (parts[1] === 'menu') {
    const { AdminMenuApi } = await backendModule<any>('../../backend/menu/controller.js');
    if (parts.length === 2 && method === 'GET') return AdminMenuApi.list() as Promise<T>;
    if (parts[2] === 'categories' && method === 'POST') return AdminMenuApi.createCategory(body) as Promise<T>;
  }

  if (parts[1] === 'inventory') {
    const { InventoryAdminApi } = await backendModule<any>('../../backend/inventory/controller.js');
    if (parts[2] === 'alerts') return InventoryAdminApi.listAlerts() as Promise<T>;
    if (parts[2] === 'deduction-policy') return InventoryAdminApi.getDeductionPolicy() as Promise<T>;
  }

  if (parts[1] === 'audit' && parts[2] === 'events') {
    const { AdminAuditApi } = await backendModule<any>('../../backend/audit/controller.js');
    return AdminAuditApi.search(await userFor(userId), Object.fromEntries(url.searchParams.entries())) as Promise<T>;
  }

  if (parts[1] === 'users') {
    const users = await backendModule<any>('../../backend/users/repository.js');
    return users.listUsers() as Promise<T>;
  }

  if (parts[1] === 'settings') {
    const branch = await backendModule<any>('../../backend/config/branch.js');
    const { InventoryAdminApi } = await backendModule<any>('../../backend/inventory/controller.js');
    return { branch: branch.getRuntimeSettings().branch, inventoryDeductionPolicy: await InventoryAdminApi.getDeductionPolicy() } as T;
  }

  if (parts[1] === 'reports') {
    const { ReportsApi } = await backendModule<any>('../../backend/reports/controller.js');
    if (parts[2] === 'sales') return ReportsApi.sales(await userFor(userId), parts[3], Object.fromEntries(url.searchParams.entries())) as Promise<T>;
  }

  throw new ApiClientError('Route not found.', 404);
}

export class RestaurantApiClient {
  private currentUserId?: string;

  constructor(private baseUrl = apiBase()) {}

  setSessionUser(userId: string | undefined): void {
    this.currentUserId = userId;
  }

  getSessionUser(): string | undefined {
    return this.currentUserId;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    const userId = options.userId ?? this.currentUserId;
    if (userId) headers['x-user-id'] = userId;

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      body = JSON.stringify(options.body);
    }

    const method = options.method ?? 'GET';
    if (typeof window === 'undefined' && !this.baseUrl) {
      return requestInProcess<T>(path, method, options.body, userId);
    }

    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers, body });
    return parseResponse<T>(response);
  }

  login(userId: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('/auth/login', { method: 'POST', body: { userId }, userId });
  }

  me(): Promise<LoginResponse> {
    return this.request<LoginResponse>('/auth/me');
  }


  listTableFloor(branchId?: string): Promise<TableFloorState[]> {
    return this.request<TableFloorState[]>(`/api/tables${queryString({ branchId })}`);
  }

  createTable(input: { id?: string; branchId?: string; name: string; capacity: number; status?: 'active' | 'inactive' }) {
    return this.request('/api/tables', { method: 'POST', body: input });
  }

  openTableSession(userId: string, tableId: string, guestCount: number, branchId?: string): Promise<TableSessionRecord> {
    return this.request<TableSessionRecord>(`/api/tables/${encodeURIComponent(tableId)}/sessions`, { method: 'POST', userId, body: { guestCount, branchId } });
  }

  closeTableSession(userId: string, tableSessionId: string): Promise<TableSessionRecord> {
    return this.request<TableSessionRecord>(`/api/tables/sessions/${encodeURIComponent(tableSessionId)}/close`, { method: 'POST', userId });
  }

  listOrders(): Promise<OrderRecord[]> {
    return this.request<OrderRecord[]>('/api/orders');
  }

  createOrder(userId: string, input: CreateOrderInput): Promise<OrderRecord> {
    return this.request<OrderRecord>('/api/orders', { method: 'POST', userId, body: input });
  }

  getOrder(orderId: string): Promise<OrderRecord | null> {
    return this.request<OrderRecord | null>(`/api/orders/${encodeURIComponent(orderId)}`);
  }

  editOrder(userId: string, orderId: string, edit: EditOrderInput): Promise<OrderRecord> {
    return this.request<OrderRecord>(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'PATCH', userId, body: edit });
  }

  transitionOrderStatus(userId: string, orderId: string, expectedVersion: number, nextStatus: OrderStatus): Promise<OrderRecord> {
    return this.request<OrderRecord>(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'POST',
      userId,
      body: { expectedVersion, nextStatus },
    });
  }

  getKdsSnapshot(station?: Station): Promise<KdsSnapshot> {
    return this.request<KdsSnapshot>(`/api/kds${queryString({ station })}`);
  }

  patchKdsItemProgress(userId: string, orderId: string, orderItemId: string, progress: KdsProgress) {
    return this.request(`/api/kds/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(orderItemId)}/progress`, {
      method: 'PATCH',
      userId,
      body: { progress },
    });
  }

  subscribeKds(station: Station | undefined, onUpdate: (event: KdsEvent) => void): () => void {
    const source = new EventSource(`${this.baseUrl}/api/kds/events${queryString({ station })}`);
    source.onmessage = (event) => onUpdate(JSON.parse(event.data) as KdsEvent);
    return () => source.close();
  }

  createBill(input: {
    tableSessionId: string;
    itemsBySplit: Partial<Record<SplitLabel, TableOrderItem[]>>;
    pricing?: Partial<BillPricingOptions>;
    locale?: string;
  }, userId?: string) {
    return this.request('/api/billing/bills', { method: 'POST', userId, body: input });
  }

  getBillBreakdown(tableSessionId: string): Promise<BillBreakdown> {
    return this.request<BillBreakdown>(`/api/billing/bills/${encodeURIComponent(tableSessionId)}/breakdown`);
  }

  getReceipt(tableSessionId: string, locale?: string): Promise<ReceiptPayload> {
    return this.request<ReceiptPayload>(`/api/billing/bills/${encodeURIComponent(tableSessionId)}/receipt${queryString({ locale })}`);
  }

  setBillTaxMode(input: { tableSessionId: string; taxMode: BillPricingOptions['taxMode']; taxRate?: number }, userId?: string) {
    return this.request(`/api/billing/bills/${encodeURIComponent(input.tableSessionId)}/tax`, { method: 'PATCH', userId, body: input });
  }

  applyBillPromotions(input: { tableSessionId: string; billPromotions: BillPromotion[] }, userId?: string) {
    return this.request(`/api/billing/bills/${encodeURIComponent(input.tableSessionId)}/promotions`, { method: 'PATCH', userId, body: input });
  }

  listMenu(): Promise<MenuCategories> {
    return this.request<MenuCategories>('/api/menu');
  }

  createMenuCategory(input: { name: string; sortOrder: number }) {
    return this.request('/api/menu/categories', { method: 'POST', body: input });
  }

  getInventoryAlerts(): Promise<InventoryAlerts> {
    return this.request<InventoryAlerts>('/api/inventory/alerts');
  }

  getInventoryDeductionPolicy(): Promise<InventoryDeductionPolicy> {
    return this.request<InventoryDeductionPolicy>('/api/inventory/deduction-policy');
  }

  searchAuditEvents(filters: AdminAuditViewerFilters, userId?: string): Promise<AuditSearchResult> {
    return this.request<AuditSearchResult>(`/api/audit/events${queryString(filters as Record<string, unknown>)}`, { userId });
  }

  listUsers() {
    return this.request<AuthenticatedUser[]>('/api/users');
  }

  getSettings() {
    return this.request('/api/settings');
  }

  getSalesReport(period: 'day' | 'week' | 'month') {
    return this.request(`/api/reports/sales/${period}`);
  }
}

export const apiClient = new RestaurantApiClient();
