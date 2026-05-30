declare const process: { env: Record<string, string | undefined>; cwd(): string };
declare const require: { main?: unknown };
declare const module: unknown;
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { loadUser, requireActiveUser, requireAuth, authorize } from './auth/middleware';
import { Actions, RolePermissions } from './auth/permissions';
import { getCurrentBranchId, getRuntimeSettings } from './config/branch';
import { listUsers } from './users/repository';
import { activateUser, createStaffProfile, deactivateUser, updateStaffProfile } from './users/service';
import { AdminMenuApi } from './menu/controller';
import { createOrderDraft, editOrderBeforePayment, cancelOrder, transitionOrderStatus, getOrder } from './orders/service';
import { listOrders } from './orders/repository';
import { listStationQueue, patchItemProgress, onKdsEvent } from './kds/controller';
import type { Station, KdsProgress } from './kds/repository';
import {
  generateBillFromSessionItems,
  setBillTaxMode,
  applyBillPromotions,
  voidBill,
  getBillCalculationBreakdown,
  getPrintedReceiptPayload,
  recordSplitPayment,
  settleDebt,
} from './billing/service';
import { InventoryAdminApi } from './inventory/controller';
import { ReportsApi } from './reports/controller';
import { AdminAuditApi } from './audit/controller';
import { TablesApi } from './tables/controller';
import type { AuthenticatedUser } from './auth/policies';
import { loginWithPassword, logoutSession } from './auth/service';
import { getIdempotencyRecord, idempotencyFingerprint, idempotencyMatches, saveIdempotencyRecord } from './network-idempotency';

const DEFAULT_PORT = 8080;
const DEFAULT_HOST = '0.0.0.0';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
type ServiceResultHandler<T> = (req: Request) => Promise<T> | T;

const idempotencyLocks = new Map<string, Promise<void>>();

async function withIdempotencyLock<T>(key: string | undefined, callback: () => Promise<T>): Promise<T> {
  if (!key) return callback();

  const previous = idempotencyLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  idempotencyLocks.set(key, queued);

  await previous;
  try {
    return await callback();
  } finally {
    if (idempotencyLocks.get(key) === queued) idempotencyLocks.delete(key);
    release();
  }
}

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function asyncRoute(handler: AsyncHandler): AsyncHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function send<T>(handler: ServiceResultHandler<T>, status = 200): AsyncHandler {
  return asyncRoute(async (req, res) => {
    await withIdempotencyLock(String((req as any).headers?.['idempotency-key'] ?? '').trim() || undefined, async () => {
      const rawReq = req as any;
      const headerValue = rawReq.headers?.['idempotency-key'];
      const idempotencyKey = typeof headerValue === 'string' ? headerValue.trim() : Array.isArray(headerValue) ? String(headerValue[0] ?? '').trim() : '';
      const method = String(rawReq.method ?? 'GET').toUpperCase();
      const path = String(rawReq.originalUrl ?? rawReq.url ?? '');
      const canReplay = idempotencyKey && !['GET', 'HEAD', 'OPTIONS'].includes(method);
      const fingerprint = canReplay ? idempotencyFingerprint({ userId: req.user?.id, method, path, body: req.body }) : null;

      if (canReplay && fingerprint) {
        const existing = await getIdempotencyRecord(idempotencyKey);
        if (existing) {
          if (!idempotencyMatches(existing, fingerprint)) {
            throw new HttpError(409, 'Idempotency key was already used for a different request.');
          }
          res.setHeader('X-Idempotency-Replayed', 'true');
          res.status(existing.statusCode).json(existing.responseBody);
          return;
        }
      }

      const data = await handler(req);
      const responseBody = { data };
      if (canReplay && fingerprint) {
        await saveIdempotencyRecord({
          key: idempotencyKey,
          ...fingerprint,
          statusCode: status,
          responseBody,
          createdAt: new Date().toISOString(),
        });
      }
      res.status(status).json(responseBody);
    });
  });
}

function bodyObject(req: Request): Record<string, unknown> {
  if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object') {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return req.body as Record<string, unknown>;
}

function queryObject(req: Request): Record<string, unknown> {
  return ((req as any).query ?? {}) as Record<string, unknown>;
}

function requireUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new HttpError(401, 'Authentication required.');
  return req.user;
}

function stringParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | undefined>)[name];
  if (!value) throw new HttpError(400, `${name} is required.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new HttpError(400, `${field} is required.`);
  return normalized;
}

function requiredNumber(value: unknown, field: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) throw new HttpError(400, `${field} must be a finite number.`);
  return numeric;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new HttpError(400, `${field} must be a boolean.`);
}

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) throw new HttpError(400, 'limit must be a positive integer.');
  return numeric;
}


function permissionsForUser(user: AuthenticatedUser) {
  const roles = Array.isArray(user.role) ? user.role : [user.role];
  return Array.from(new Set(roles.flatMap((role) => RolePermissions[role] ?? []))).sort();
}

function buildAuthRouter(): Router {
  const router = express.Router();
  router.post('/login', send(async (req) => {
    const body = bodyObject(req);
    const identifier = requiredString(body.identifier ?? body.username ?? body.email ?? body.userId, 'identifier');
    const password = requiredString(body.password, 'password');
    const result = await loginWithPassword({ identifier, password });
    return { ...result, permissions: permissionsForUser(result.user) };
  }));
  router.post('/logout', requireAuth, send(async (req) => {
    if ((req as any).sessionToken) await logoutSession((req as any).sessionToken, req.user);
    return { ok: true };
  }));
  router.get('/me', requireAuth, asyncRoute(requireActiveUser as AsyncHandler), send((req) => ({ user: requireUser(req), permissions: permissionsForUser(requireUser(req)) })));
  return router;
}

function buildMenuRouter(): Router {
  const router = express.Router();
  router.use(authorize(Actions.ManageMenu));
  router.get('/', send(() => AdminMenuApi.list()));
  router.post('/categories', send((req) => AdminMenuApi.createCategory(bodyObject(req) as any), 201));
  router.patch('/categories/:categoryId', send((req) => AdminMenuApi.updateCategory(stringParam(req, 'categoryId'), bodyObject(req) as any)));
  router.delete('/categories/:categoryId', send((req) => AdminMenuApi.deleteCategory(stringParam(req, 'categoryId'))));
  router.post('/items', send((req) => AdminMenuApi.createItem(bodyObject(req) as any), 201));
  router.patch('/items/:itemId', send((req) => AdminMenuApi.updateItem(stringParam(req, 'itemId'), bodyObject(req) as any)));
  router.delete('/items/:itemId', send((req) => AdminMenuApi.deleteItem(stringParam(req, 'itemId'))));
  router.patch('/items/:itemId/availability', send((req) => AdminMenuApi.setAvailability(stringParam(req, 'itemId'), parseBoolean(bodyObject(req).isAvailable, 'isAvailable'))));
  router.patch('/items/:itemId/promotional', send((req) => AdminMenuApi.setPromotional(stringParam(req, 'itemId'), parseBoolean(bodyObject(req).isPromotional, 'isPromotional'))));
  return router;
}


function buildTablesRouter(): Router {
  const router = express.Router();
  router.get('/', send((req) => TablesApi.listFloor(optionalString(queryObject(req).branchId) ?? getCurrentBranchId())));
  router.post('/', authorize(Actions.CreateOrder), send((req) => TablesApi.createTable(bodyObject(req) as any), 201));
  router.patch('/:tableId', authorize(Actions.CreateOrder), send((req) => TablesApi.updateTable(stringParam(req, 'tableId'), bodyObject(req) as any)));
  router.delete('/:tableId', authorize(Actions.CreateOrder), send((req) => TablesApi.removeTable(stringParam(req, 'tableId'))));
  router.get('/:tableId/sessions', send((req) => TablesApi.listSessionsForTable(stringParam(req, 'tableId'))));
  router.post('/:tableId/sessions', authorize(Actions.CreateOrder), send((req) => {
    const body = bodyObject(req);
    return TablesApi.openSession(requireUser(req), { tableId: stringParam(req, 'tableId'), guestCount: requiredNumber(body.guestCount, 'guestCount'), branchId: optionalString(body.branchId) });
  }, 201));
  router.get('/sessions/:tableSessionId', send((req) => TablesApi.getSession(stringParam(req, 'tableSessionId'))));
  router.post('/sessions/:tableSessionId/close', authorize(Actions.CreateOrder), send((req) => TablesApi.closeSession(requireUser(req), stringParam(req, 'tableSessionId'))));
  return router;
}

function buildOrdersRouter(): Router {
  const router = express.Router();
  router.get('/', send(() => listOrders()));
  router.post('/', authorize(Actions.CreateOrder), send((req) => createOrderDraft(requireUser(req), bodyObject(req) as any), 201));
  router.get('/:orderId', send((req) => getOrder(stringParam(req, 'orderId'))));
  router.patch('/:orderId', authorize(Actions.EditOrder), send((req) => editOrderBeforePayment(requireUser(req), stringParam(req, 'orderId'), bodyObject(req) as any)));
  router.post('/:orderId/cancel', authorize(Actions.EditOrder), send((req) => cancelOrder(requireUser(req), stringParam(req, 'orderId'), bodyObject(req) as any)));
  router.post('/:orderId/status', authorize(Actions.TransitionOrderStatus), send((req) => {
    const body = bodyObject(req);
    return transitionOrderStatus(requireUser(req), stringParam(req, 'orderId'), requiredNumber(body.expectedVersion, 'expectedVersion'), requiredString(body.nextStatus, 'nextStatus') as any);
  }));
  return router;
}

function buildKdsRouter(): Router {
  const router = express.Router();
  router.use(authorize(Actions.TransitionOrderStatus));
  router.get('/', send((req) => listStationQueue(optionalString(queryObject(req).station) as Station | undefined)));
  router.patch('/orders/:orderId/items/:orderItemId/progress', send((req) => {
    const body = bodyObject(req);
    return patchItemProgress(requireUser(req), stringParam(req, 'orderId'), stringParam(req, 'orderItemId'), requiredString(body.progress, 'progress') as KdsProgress);
  }));
  router.get('/events', asyncRoute(async (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

    const writeEvent = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    writeEvent({ type: 'snapshot', at: new Date().toISOString(), payload: await listStationQueue(optionalString(queryObject(req).station) as Station | undefined) });
    const unsubscribe = onKdsEvent(writeEvent);
    req.on('close', unsubscribe);
  }));
  return router;
}

function buildBillingRouter(): Router {
  const router = express.Router();
  router.post('/bills', authorize(Actions.CloseBill), send((req) => {
    const body = bodyObject(req);
    return generateBillFromSessionItems(requiredString(body.tableSessionId, 'tableSessionId'), (body.itemsBySplit ?? {}) as any, req.user!.id, body.pricing as any, optionalString(body.branchId) ?? getCurrentBranchId());
  }, 201));
  router.patch('/bills/:tableSessionId/tax', authorize(Actions.CloseBill), send((req) => setBillTaxMode({ ...bodyObject(req), tableSessionId: stringParam(req, 'tableSessionId'), actorUserId: req.user!.id } as any)));
  router.patch('/bills/:tableSessionId/promotions', authorize(Actions.CloseBill), send((req) => applyBillPromotions({ ...bodyObject(req), tableSessionId: stringParam(req, 'tableSessionId'), actorUserId: req.user!.id } as any)));
  router.post('/bills/:tableSessionId/void', authorize(Actions.CloseBill), send((req) => voidBill({ ...bodyObject(req), tableSessionId: stringParam(req, 'tableSessionId'), actorUserId: req.user!.id } as any)));
  router.get('/bills/:tableSessionId/breakdown', authorize(Actions.CloseBill), send((req) => getBillCalculationBreakdown(stringParam(req, 'tableSessionId'))));
  router.get('/bills/:tableSessionId/receipt', authorize(Actions.CloseBill), send((req) => getPrintedReceiptPayload(stringParam(req, 'tableSessionId'), optionalString(queryObject(req).locale))));
  router.post('/bills/:tableSessionId/payments', authorize(Actions.CloseBill), send((req) => recordSplitPayment({ ...bodyObject(req), tableSessionId: stringParam(req, 'tableSessionId'), actorUserId: req.user!.id } as any)));
  router.post('/bills/:tableSessionId/debt/settlements', authorize(Actions.MarkDebt), send((req) => settleDebt({ ...bodyObject(req), tableSessionId: stringParam(req, 'tableSessionId'), actorUserId: req.user!.id } as any)));
  return router;
}

function buildInventoryRouter(): Router {
  const router = express.Router();
  router.use(authorize(Actions.AdjustStock));
  router.get('/items', send(() => InventoryAdminApi.listItems()));
  router.post('/items', send((req) => InventoryAdminApi.createItem(bodyObject(req) as any), 201));
  router.post('/movements', send((req) => InventoryAdminApi.addMovement(bodyObject(req) as any, req.user!.id), 201));
  router.get('/alerts', send(() => InventoryAdminApi.listAlerts()));
  router.get('/deduction-policy', send(() => InventoryAdminApi.getDeductionPolicy()));
  router.put('/deduction-policy', send((req) => InventoryAdminApi.setDeductionPolicy(requireUser(req), requiredString(bodyObject(req).policy, 'policy') as any)));
  return router;
}

function buildReportsRouter(): Router {
  const router = express.Router();
  router.use(authorize(Actions.ViewReports));
  router.get('/sales/:period', send((req) => ReportsApi.sales(requireUser(req), stringParam(req, 'period') as any, queryObject(req) as any)));
  router.get('/sales/day', send((req) => ReportsApi.salesByDay(requireUser(req), queryObject(req) as any)));
  router.get('/sales/week', send((req) => ReportsApi.salesByWeek(requireUser(req), queryObject(req) as any)));
  router.get('/sales/month', send((req) => ReportsApi.salesByMonth(requireUser(req), queryObject(req) as any)));
  router.get('/inventory-usage', send((req) => ReportsApi.inventoryUsage(requireUser(req), queryObject(req) as any)));
  router.get('/financial-summary', send((req) => ReportsApi.financialSummary(requireUser(req), queryObject(req) as any)));
  return router;
}

function buildAuditRouter(): Router {
  const router = express.Router();
  router.use(authorize(Actions.ViewAudit));
  router.get('/events', send((req) => AdminAuditApi.search(requireUser(req), { ...queryObject(req), limit: parseLimit(queryObject(req).limit) } as any)));
  return router;
}

function buildUsersRouter(): Router {
  const router = express.Router();
  router.use(authorize(Actions.ManageStaff));
  router.get('/', send(() => listUsers()));
  router.post('/', send((req) => createStaffProfile(requireUser(req), bodyObject(req) as any), 201));
  router.patch('/:userId', send((req) => updateStaffProfile(requireUser(req), stringParam(req, 'userId'), bodyObject(req) as any)));
  router.post('/:userId/activate', send((req) => activateUser(stringParam(req, 'userId'), requireUser(req))));
  router.post('/:userId/deactivate', send((req) => deactivateUser(stringParam(req, 'userId'), requireUser(req))));
  return router;
}

function buildSettingsRouter(): Router {
  const router = express.Router();
  router.get('/', send(() => ({ branch: getRuntimeSettings().branch, inventoryDeductionPolicy: InventoryAdminApi.getDeductionPolicy() })));
  router.get('/branch', send(() => getRuntimeSettings().branch));
  router.get('/inventory/deduction-policy', authorize(Actions.AdjustStock), send(() => InventoryAdminApi.getDeductionPolicy()));
  router.put('/inventory/deduction-policy', authorize(Actions.AdjustStock), send((req) => InventoryAdminApi.setDeductionPolicy(requireUser(req), requiredString(bodyObject(req).policy, 'policy') as any)));
  return router;
}

function mapErrorToHttp(error: unknown): { statusCode: number; message: string; details?: unknown } {
  if (error instanceof HttpError) return { statusCode: error.statusCode, message: error.message, details: error.details };
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  if (/authentication required|invalid credentials/i.test(message)) return { statusCode: 401, message };
  if (/forbidden|cannot .* permission|missing permission/i.test(message)) return { statusCode: 403, message };
  if (/not found|not exist/i.test(message)) return { statusCode: 404, message };
  if (/version conflict|already exists|already cancelled|already closed|active session already exists|cannot be modified|cannot be cancelled|cannot be voided|cannot close|cannot delete/i.test(message)) return { statusCode: 409, message };
  if (/invalid|required|must be|use a, b, or c|greater than zero|non-negative|non-zero/i.test(message)) return { statusCode: 400, message };
  return { statusCode: 500, message };
}


const frontendContentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function mountFrontendApp(app: ReturnType<typeof express>): void {
  const frontendRoot = join(process.cwd(), 'dist', 'frontend');
  const indexPath = join(frontendRoot, 'index.html');
  if (!existsSync(indexPath)) return;

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    const pathname = decodeURIComponent(new URL((req as any).url ?? '/', 'http://localhost').pathname);
    if (pathname === '/healthz' || pathname.startsWith('/api') || pathname.startsWith('/auth')) {
      next();
      return;
    }

    const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const candidate = join(frontendRoot, safePath);
    const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : indexPath;
    res.setHeader('content-type', frontendContentTypes.get(extname(file)) ?? 'application/octet-stream');
    createReadStream(file).pipe(res as any);
  });
}

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const httpError = mapErrorToHttp(error);
  res.status(httpError.statusCode).json({ error: httpError.message, details: httpError.details });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(asyncRoute(loadUser as AsyncHandler));
  app.get('/healthz', (_req: Request, res: Response) => res.json({ ok: true, at: new Date().toISOString() }));
  app.get('/api/health', (_req: Request, res: Response) => res.json({ data: { ok: true, status: 'healthy', at: new Date().toISOString() } }));
  app.use('/auth', buildAuthRouter());

  const api = express.Router();
  api.use(requireAuth, asyncRoute(requireActiveUser as AsyncHandler));
  api.use('/menu', buildMenuRouter());
  api.use('/tables', buildTablesRouter());
  api.use('/orders', buildOrdersRouter());
  api.use('/kds', buildKdsRouter());
  api.use('/billing', buildBillingRouter());
  api.use('/inventory', buildInventoryRouter());
  api.use('/reports', buildReportsRouter());
  api.use('/audit', buildAuditRouter());
  api.use('/users', buildUsersRouter());
  api.use('/settings', buildSettingsRouter());

  app.use('/api', api);
  mountFrontendApp(app);
  app.use((_req: Request, _res: Response, next: NextFunction) => next(new HttpError(404, 'Route not found.')));
  app.use(errorHandler);
  return app;
}

export function startServer(): unknown {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const host = process.env.HOST ?? DEFAULT_HOST;
  const app = createApp();
  const server = app.listen(port, host, () => {
    console.log(`RestaurantPOS API listening on http://${host}:${port}`);
  });
  return server;
}

if (require.main === module) {
  startServer();
}
