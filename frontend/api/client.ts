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
import { maxAttemptsForOperation, reconnectDelayMs, shouldRetryLanFailure, type LanOperationKind } from '../network/reconnect-policy';

type BillBreakdown = Awaited<ReturnType<typeof getBillCalculationBreakdown>>;
type ReceiptPayload = Awaited<ReturnType<typeof getPrintedReceiptPayload>>;
type MenuCategories = Awaited<ReturnType<typeof AdminMenuApi.list>>;
type InventoryAlerts = Awaited<ReturnType<typeof InventoryAdminApi.listAlerts>>;
type InventoryItems = Awaited<ReturnType<typeof InventoryAdminApi.listItems>>;
type InventoryDeductionPolicy = Awaited<ReturnType<typeof InventoryAdminApi.getDeductionPolicy>>;
type AuditSearchResult = Awaited<ReturnType<typeof AdminAuditApi.search>>;
type InventoryUsageReport = Awaited<ReturnType<typeof import('../../backend/reports/controller').ReportsApi.inventoryUsage>>;
type FinancialSummaryReport = Awaited<ReturnType<typeof import('../../backend/reports/controller').ReportsApi.financialSummary>>;
type SalesReport = Awaited<ReturnType<typeof import('../../backend/reports/controller').ReportsApi.sales>>;
type ReportFilters = import('../../backend/reports/service').ReportFilters;

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

export type ApiNetworkStatus = 'online' | 'degraded' | 'offline';
export type ApiNetworkListener = (status: ApiNetworkStatus, detail?: { message?: string; attempt?: number }) => void;

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
  token: string;
  expiresAt: string;
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  userId?: string;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  operationKind?: LanOperationKind;
  idempotencyKey?: string;
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


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function requestFingerprint(method: string, path: string, body: unknown): string {
  return `${method.toUpperCase()} ${path} ${stableStringify(body)}`;
}

function randomKeyPart(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && 'randomUUID' in cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createIdempotencyKey(method: string, path: string): string {
  return `pos:${method.toUpperCase()}:${path}:${randomKeyPart()}`;
}

function isLanFailureStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function inferOperationKind(method: string): LanOperationKind {
  return method.toUpperCase() === 'GET' ? 'read' : 'unsafe_write';
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
    const service = await backendModule<any>('../../backend/auth/service.js');
    const permissions = await backendModule<any>('../../backend/auth/permissions.js');
    const bootstrap = await backendModule<any>('../../backend/bootstrap/demoData.js');
    const usersBootstrap = await backendModule<any>('../../backend/users/bootstrap.js');
    await usersBootstrap.ensureDefaultSuperadmin();
    await bootstrap.ensureStarterRestaurantData();
    const loginBody = body as { identifier?: string; username?: string; email?: string; userId?: string; password?: string };
    const result = await service.loginWithPassword({ identifier: loginBody.identifier ?? loginBody.username ?? loginBody.email ?? loginBody.userId ?? '', password: loginBody.password ?? '' });
    const roles = Array.isArray(result.user.role) ? result.user.role : [result.user.role];
    return { ...result, permissions: Array.from(new Set(roles.flatMap((role: string) => permissions.RolePermissions[role] ?? []))).sort() } as T;
  }

  if (url.pathname === '/auth/logout') return { ok: true } as T;

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
    if (parts.length === 4 && parts[3] === 'print') {
      const printer = await backendModule<any>('../../backend/hardware/orderPrinter.js');
      const order = await service.getOrder(parts[2]);
      if (!order) throw new ApiClientError('Order not found.', 404);
      const printed = (await Promise.all([printer.getOrderPrinterAdapter().printOrder(order, 'kitchen'), printer.getOrderPrinterAdapter().printOrder(order, 'bar')])).filter(Boolean);
      return { orderId: order.id, printed } as T;
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
    if (parts[4] === 'print') return billing.printBillReceipt({ ...(body as object), tableSessionId, actorUserId: userId }) as Promise<T>;
    if (parts[4] === 'payments') return billing.recordSplitPayment({ ...(body as object), tableSessionId, actorUserId: userId }) as Promise<T>;
  }

  if (parts[1] === 'menu') {
    const { AdminMenuApi } = await backendModule<any>('../../backend/menu/controller.js');
    if (parts.length === 2 && method === 'GET') return AdminMenuApi.list() as Promise<T>;
    if (parts[2] === 'categories' && method === 'POST') return AdminMenuApi.createCategory(body) as Promise<T>;
    if (parts[2] === 'items' && method === 'POST') return AdminMenuApi.createItem(body) as Promise<T>;
    if (parts[2] === 'items' && parts.length === 4 && method === 'PATCH') return AdminMenuApi.updateItem(parts[3], body) as Promise<T>;
    if (parts[2] === 'items' && parts.length === 5 && parts[4] === 'availability' && method === 'PATCH') return AdminMenuApi.setAvailability(parts[3], Boolean((body as any).isAvailable)) as Promise<T>;
    if (parts[2] === 'items' && parts.length === 5 && parts[4] === 'promotional' && method === 'PATCH') return AdminMenuApi.setPromotional(parts[3], Boolean((body as any).isPromotional)) as Promise<T>;
    if (parts[2] === 'items' && parts.length === 4 && method === 'DELETE') return AdminMenuApi.deleteItem(parts[3]) as Promise<T>;
  }

  if (parts[1] === 'inventory') {
    const { InventoryAdminApi } = await backendModule<any>('../../backend/inventory/controller.js');
    if (parts[2] === 'items' && method === 'GET') return InventoryAdminApi.listItems() as Promise<T>;
    if (parts[2] === 'items' && method === 'POST') return InventoryAdminApi.createItem(body) as Promise<T>;
    if (parts[2] === 'movements' && method === 'POST') return InventoryAdminApi.addMovement(body, userId) as Promise<T>;
    if (parts[2] === 'alerts') return InventoryAdminApi.listAlerts() as Promise<T>;
    if (parts[2] === 'deduction-policy' && method === 'GET') return InventoryAdminApi.getDeductionPolicy() as Promise<T>;
    if (parts[2] === 'deduction-policy' && method === 'PUT') return InventoryAdminApi.setDeductionPolicy(await userFor(userId), (body as any).policy) as Promise<T>;
  }

  if (parts[1] === 'audit' && parts[2] === 'events') {
    const { AdminAuditApi } = await backendModule<any>('../../backend/audit/controller.js');
    return AdminAuditApi.search(await userFor(userId), Object.fromEntries(url.searchParams.entries())) as Promise<T>;
  }

  if (parts[1] === 'users') {
    const users = await backendModule<any>('../../backend/users/repository.js');
    const service = await backendModule<any>('../../backend/users/service.js');
    const actor = await userFor(userId);
    if (parts.length === 2 && method === 'GET') return users.listUsers() as Promise<T>;
    if (parts.length === 2 && method === 'POST') return service.createStaffProfile(actor, body) as Promise<T>;
    if (parts.length === 3 && method === 'PATCH') return service.updateStaffProfile(actor, parts[2], body) as Promise<T>;
    if (parts.length === 4 && parts[3] === 'activate') return service.activateUser(parts[2], actor) as Promise<T>;
    if (parts.length === 4 && parts[3] === 'deactivate') return service.deactivateUser(parts[2], actor) as Promise<T>;
  }

  if (parts[1] === 'settings') {
    const branch = await backendModule<any>('../../backend/config/branch.js');
    const { InventoryAdminApi } = await backendModule<any>('../../backend/inventory/controller.js');
    const posSettings = await backendModule<any>('../../backend/config/posSettings.js');
    if (method === 'PUT') return { branch: branch.getRuntimeSettings().branch, inventoryDeductionPolicy: await InventoryAdminApi.getDeductionPolicy(), pos: posSettings.updatePosOperationalSettings((body as any).pos ?? body) } as T;
    return { branch: branch.getRuntimeSettings().branch, inventoryDeductionPolicy: await InventoryAdminApi.getDeductionPolicy(), pos: posSettings.getPosOperationalSettings() } as T;
  }

  if (parts[1] === 'reports') {
    const { ReportsApi } = await backendModule<any>('../../backend/reports/controller.js');
    if (parts[2] === 'sales') return ReportsApi.sales(await userFor(userId), parts[3], Object.fromEntries(url.searchParams.entries())) as Promise<T>;
    if (parts[2] === 'inventory-usage') return ReportsApi.inventoryUsage(await userFor(userId), Object.fromEntries(url.searchParams.entries())) as Promise<T>;
    if (parts[2] === 'financial-summary') return ReportsApi.financialSummary(await userFor(userId), Object.fromEntries(url.searchParams.entries())) as Promise<T>;
  }

  throw new ApiClientError('Route not found.', 404);
}

export class RestaurantApiClient {
  private currentUserId?: string;
  private currentToken?: string;
  private readonly listeners = new Set<ApiNetworkListener>();
  private networkStatus: ApiNetworkStatus = 'online';
  private readonly inFlightWrites = new Map<string, Promise<unknown>>();

  constructor(private baseUrl = apiBase()) {}

  setSessionUser(userId: string | undefined): void {
    this.currentUserId = userId;
  }

  setSessionToken(token: string | undefined): void {
    this.currentToken = token;
  }

  getSessionUser(): string | undefined {
    return this.currentUserId;
  }

  getNetworkStatus(): ApiNetworkStatus {
    return this.networkStatus;
  }

  onNetworkStatus(listener: ApiNetworkListener): () => void {
    this.listeners.add(listener);
    listener(this.networkStatus);
    return () => this.listeners.delete(listener);
  }

  private setNetworkStatus(status: ApiNetworkStatus, detail?: { message?: string; attempt?: number }): void {
    this.networkStatus = status;
    for (const listener of this.listeners) listener(status, detail);
  }

  async health(): Promise<{ ok: boolean; status: string; at: string }> {
    return this.request<{ ok: boolean; status: string; at: string }>('/api/health', { operationKind: 'read' });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    const userId = options.userId ?? this.currentUserId;
    const token = options.token ?? this.currentToken;
    if (token) headers.authorization = `Bearer ${token}`;
    else if (userId) headers['x-user-id'] = userId;

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      body = JSON.stringify(options.body);
    }

    const method = options.method ?? 'GET';
    const operationKind = options.operationKind ?? inferOperationKind(method);
    if (operationKind === 'idempotent_write') headers['idempotency-key'] = options.idempotencyKey ?? headers['idempotency-key'] ?? createIdempotencyKey(method, path);
    else if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    if (typeof window === 'undefined' && !this.baseUrl) {
      return requestInProcess<T>(path, method, options.body, userId);
    }

    const maxAttempts = maxAttemptsForOperation(operationKind);
    const dedupeKey = operationKind !== 'read' ? requestFingerprint(method, path, options.body) : undefined;
    if (dedupeKey && this.inFlightWrites.has(dedupeKey)) return this.inFlightWrites.get(dedupeKey) as Promise<T>;

    const run = async (): Promise<T> => {
      let attempt = 1;
      for (;;) {
        try {
          const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers, body });
          if (!response.ok && isLanFailureStatus(response.status) && shouldRetryLanFailure(operationKind, attempt)) {
            this.setNetworkStatus('degraded', { message: `Retrying ${method} ${path} after HTTP ${response.status} (attempt ${attempt + 1}/${maxAttempts}).`, attempt });
            await sleep(reconnectDelayMs(attempt));
            attempt += 1;
            continue;
          }
          const parsed = await parseResponse<T>(response);
          if (attempt > 1 || this.networkStatus !== 'online') this.setNetworkStatus('online', { message: 'API connection restored.', attempt });
          return parsed;
        } catch (caught) {
          if (caught instanceof ApiClientError) throw caught;
          if (!shouldRetryLanFailure(operationKind, attempt)) {
            this.setNetworkStatus('offline', { message: caught instanceof Error ? caught.message : 'API request failed.', attempt });
            throw caught;
          }
          this.setNetworkStatus('degraded', { message: `${caught instanceof Error ? caught.message : 'API request failed; retrying.'} Retrying attempt ${attempt + 1}/${maxAttempts}.`, attempt });
          await sleep(reconnectDelayMs(attempt));
          attempt += 1;
        }
      }
    };

    const promise = run();
    if (dedupeKey) {
      this.inFlightWrites.set(dedupeKey, promise);
      promise.then(() => this.inFlightWrites.delete(dedupeKey), () => this.inFlightWrites.delete(dedupeKey));
    }
    return promise;
  }

  login(identifier: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('/auth/login', { method: 'POST', body: { identifier, password } });
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
  }

  me(): Promise<LoginResponse> {
    return this.request<LoginResponse>('/auth/me');
  }


  listTableFloor(branchId?: string): Promise<TableFloorState[]> {
    return this.request<TableFloorState[]>(`/api/tables${queryString({ branchId })}`);
  }

  createTable(input: { id?: string; branchId?: string; name: string; capacity: number; status?: 'active' | 'inactive'; layoutX?: number; layoutY?: number }) {
    return this.request('/api/tables', { method: 'POST', body: input });
  }

  updateTable(tableId: string, input: { name?: string; capacity?: number; status?: 'active' | 'inactive'; layoutX?: number; layoutY?: number }) {
    return this.request(`/api/tables/${encodeURIComponent(tableId)}`, { method: 'PATCH', body: input });
  }

  removeTable(tableId: string): Promise<{ deleted: boolean }> {
    return this.request<{ deleted: boolean }>(`/api/tables/${encodeURIComponent(tableId)}`, { method: 'DELETE' });
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
    return this.request<OrderRecord>('/api/orders', { method: 'POST', userId, body: input, operationKind: 'idempotent_write' });
  }

  getOrder(orderId: string): Promise<OrderRecord | null> {
    return this.request<OrderRecord | null>(`/api/orders/${encodeURIComponent(orderId)}`);
  }

  editOrder(userId: string, orderId: string, edit: EditOrderInput): Promise<OrderRecord> {
    return this.request<OrderRecord>(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'PATCH', userId, body: edit, operationKind: 'idempotent_write' });
  }

  transitionOrderStatus(userId: string, orderId: string, expectedVersion: number, nextStatus: OrderStatus): Promise<OrderRecord> {
    return this.request<OrderRecord>(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'POST',
      userId,
      body: { expectedVersion, nextStatus },
      operationKind: 'idempotent_write',
    });
  }

  printOrderTickets(userId: string, orderId: string) {
    return this.request(`/api/orders/${encodeURIComponent(orderId)}/print`, { method: 'POST', userId, operationKind: 'idempotent_write' });
  }

  getKdsSnapshot(station?: Station): Promise<KdsSnapshot> {
    return this.request<KdsSnapshot>(`/api/kds${queryString({ station })}`);
  }

  patchKdsItemProgress(userId: string, orderId: string, orderItemId: string, progress: KdsProgress) {
    return this.request(`/api/kds/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(orderItemId)}/progress`, {
      method: 'PATCH',
      userId,
      body: { progress },
      operationKind: 'idempotent_write',
    });
  }

  subscribeKds(station: Station | undefined, onUpdate: (event: KdsEvent) => void): () => void {
    const source = new EventSource(`${this.baseUrl}/api/kds/events${queryString({ station })}`);
    source.onmessage = (event) => {
      this.setNetworkStatus('online', { message: 'KDS stream connected.' });
      onUpdate(JSON.parse(event.data) as KdsEvent);
    };
    source.onerror = () => {
      this.setNetworkStatus('degraded', { message: 'KDS stream disconnected; reloading snapshot.' });
      void this.getKdsSnapshot(station).then((snapshot) => onUpdate({ type: 'snapshot', at: new Date().toISOString(), payload: snapshot })).catch((caught) => {
        this.setNetworkStatus('offline', { message: caught instanceof Error ? caught.message : 'KDS reload failed.' });
      });
    };
    return () => source.close();
  }

  createBill(input: {
    tableSessionId: string;
    itemsBySplit: Partial<Record<SplitLabel, TableOrderItem[]>>;
    pricing?: Partial<BillPricingOptions>;
    locale?: string;
  }, userId?: string) {
    return this.request('/api/billing/bills', { method: 'POST', userId, body: input, operationKind: 'idempotent_write' });
  }

  getBillBreakdown(tableSessionId: string): Promise<BillBreakdown> {
    return this.request<BillBreakdown>(`/api/billing/bills/${encodeURIComponent(tableSessionId)}/breakdown`);
  }

  getReceipt(tableSessionId: string, locale?: string): Promise<ReceiptPayload> {
    return this.request<ReceiptPayload>(`/api/billing/bills/${encodeURIComponent(tableSessionId)}/receipt${queryString({ locale })}`);
  }

  printReceipt(tableSessionId: string, input: { locale?: string; copies?: number; printerId?: string } = {}, userId?: string) {
    return this.request(`/api/billing/bills/${encodeURIComponent(tableSessionId)}/print`, { method: 'POST', userId, body: input, operationKind: 'idempotent_write' });
  }

  setBillTaxMode(input: { tableSessionId: string; taxMode: BillPricingOptions['taxMode']; taxRate?: number }, userId?: string) {
    return this.request(`/api/billing/bills/${encodeURIComponent(input.tableSessionId)}/tax`, { method: 'PATCH', userId, body: input, operationKind: 'idempotent_write' });
  }

  applyBillPromotions(input: { tableSessionId: string; billPromotions: BillPromotion[] }, userId?: string) {
    return this.request(`/api/billing/bills/${encodeURIComponent(input.tableSessionId)}/promotions`, { method: 'PATCH', userId, body: input, operationKind: 'idempotent_write' });
  }

  recordSplitPayment(input: { tableSessionId: string; splitLabel: SplitLabel; amount: number; method: string; createDebtForUnpaidBalance?: boolean }, userId?: string, idempotencyKey?: string) {
    return this.request(`/api/billing/bills/${encodeURIComponent(input.tableSessionId)}/payments`, { method: 'POST', userId, body: input, operationKind: 'unsafe_write', idempotencyKey });
  }

  listMenu(): Promise<MenuCategories> {
    return this.request<MenuCategories>('/api/menu');
  }

  createMenuCategory(input: { name: string; sortOrder: number }) {
    return this.request('/api/menu/categories', { method: 'POST', body: input });
  }

  createMenuItem(input: { categoryId: string; name: string; description?: string; price: number; prepStation?: 'kitchen' | 'bar'; isAvailable?: boolean; isPromotional?: boolean }) {
    return this.request('/api/menu/items', { method: 'POST', body: input });
  }

  updateMenuItem(itemId: string, input: { name?: string; description?: string; price?: number; prepStation?: 'kitchen' | 'bar'; isAvailable?: boolean; isPromotional?: boolean }) {
    return this.request(`/api/menu/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: input });
  }

  deleteMenuItem(itemId: string) {
    return this.request(`/api/menu/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
  }

  setMenuItemAvailability(itemId: string, isAvailable: boolean) {
    return this.request(`/api/menu/items/${encodeURIComponent(itemId)}/availability`, { method: 'PATCH', body: { isAvailable } });
  }

  setMenuItemPromotional(itemId: string, isPromotional: boolean) {
    return this.request(`/api/menu/items/${encodeURIComponent(itemId)}/promotional`, { method: 'PATCH', body: { isPromotional } });
  }

  listInventoryItems(): Promise<InventoryItems> {
    return this.request<InventoryItems>('/api/inventory/items');
  }

  createInventoryItem(input: { sku: string; name: string; unit: string; minimumThreshold: number; currentStock: number }) {
    return this.request('/api/inventory/items', { method: 'POST', body: input });
  }

  addInventoryMovement(input: { itemId: string; movementType: 'restock' | 'manual_adjustment' | 'wastage' | 'sale_deduction'; quantityDelta: number; reason?: string }) {
    return this.request('/api/inventory/movements', { method: 'POST', body: input, operationKind: 'idempotent_write' });
  }

  getInventoryAlerts(): Promise<InventoryAlerts> {
    return this.request<InventoryAlerts>('/api/inventory/alerts');
  }

  getInventoryDeductionPolicy(): Promise<InventoryDeductionPolicy> {
    return this.request<InventoryDeductionPolicy>('/api/inventory/deduction-policy');
  }

  setInventoryDeductionPolicy(policy: InventoryDeductionPolicy) {
    return this.request('/api/inventory/deduction-policy', { method: 'PUT', body: { policy } });
  }

  searchAuditEvents(filters: AdminAuditViewerFilters, userId?: string): Promise<AuditSearchResult> {
    return this.request<AuditSearchResult>(`/api/audit/events${queryString(filters as Record<string, unknown>)}`, { userId });
  }

  listUsers() {
    return this.request<AuthenticatedUser[]>('/api/users');
  }

  createUser(input: { id?: string; username: string; email?: string; password: string; role: string | string[]; branchId?: string; status?: 'active' | 'inactive' }) {
    return this.request<AuthenticatedUser>('/api/users', { method: 'POST', body: input });
  }

  updateUser(userId: string, input: { username?: string; email?: string; password?: string; role?: string | string[]; branchId?: string; status?: 'active' | 'inactive' }) {
    return this.request<AuthenticatedUser>(`/api/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: input });
  }

  activateUser(userId: string) {
    return this.request<AuthenticatedUser>(`/api/users/${encodeURIComponent(userId)}/activate`, { method: 'POST' });
  }

  deactivateUser(userId: string) {
    return this.request<AuthenticatedUser>(`/api/users/${encodeURIComponent(userId)}/deactivate`, { method: 'POST' });
  }

  getSettings() {
    return this.request('/api/settings');
  }

  updateSettings(input: unknown) {
    return this.request('/api/settings', { method: 'PUT', body: input, operationKind: 'idempotent_write' });
  }

  getSalesReport(period: 'day' | 'week' | 'month', filters: ReportFilters = {}): Promise<SalesReport> {
    return this.request<SalesReport>(`/api/reports/sales/${period}${queryString(filters as Record<string, unknown>)}`);
  }

  getInventoryUsageReport(): Promise<InventoryUsageReport> {
    return this.request<InventoryUsageReport>('/api/reports/inventory-usage');
  }

  getFinancialSummaryReport(): Promise<FinancialSummaryReport> {
    return this.request<FinancialSummaryReport>('/api/reports/financial-summary');
  }
}

export const apiClient = new RestaurantApiClient();
