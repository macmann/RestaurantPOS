declare const process: { env: Record<string, string | undefined> };
declare const require: { main?: unknown };
declare const module: unknown;
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { requireActiveUser, requireAuth, authorize } from './auth/middleware';
import { Actions } from './auth/permissions';
import { getCurrentBranchId, getRuntimeSettings } from './config/branch';
import { saveUser, getUserById, listUsers } from './users/repository';
import { activateUser, deactivateUser } from './users/service';
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
import type { AuthenticatedUser } from './auth/policies';

const DEFAULT_PORT = 8080;
const DEFAULT_HOST = '0.0.0.0';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
type ServiceResultHandler<T> = (req: Request) => Promise<T> | T;

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

function getHeader(req: Request, name: string): string | undefined {
  const value = (req as any).headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = getHeader(req, 'x-user-id');
  if (userId) {
    req.user = (await getUserById(userId)) ?? undefined;
  }
  next();
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
    const data = await handler(req);
    res.status(status).json({ data });
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
  router.use(authorize(Actions.ViewAudit));
  router.get('/', send(() => listUsers()));
  router.post('/', send(async (req) => {
    const body = bodyObject(req);
    const user: AuthenticatedUser = {
      id: requiredString(body.id, 'id'),
      branchId: optionalString(body.branchId),
      role: Array.isArray(body.role) ? body.role.map((role) => requiredString(role, 'role')) : requiredString(body.role, 'role'),
      status: (optionalString(body.status) as any) ?? 'active',
    };
    await saveUser(user);
    return user;
  }, 201));
  router.post('/:userId/activate', send((req) => activateUser(stringParam(req, 'userId'))));
  router.post('/:userId/deactivate', send((req) => deactivateUser(stringParam(req, 'userId'))));
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
  if (/authentication required/i.test(message)) return { statusCode: 401, message };
  if (/forbidden|cannot .* permission|missing permission/i.test(message)) return { statusCode: 403, message };
  if (/not found|not exist/i.test(message)) return { statusCode: 404, message };
  if (/version conflict|already exists|already cancelled|cannot be modified|cannot be cancelled|cannot be voided/i.test(message)) return { statusCode: 409, message };
  if (/invalid|required|must be|use a, b, or c|greater than zero|non-negative|non-zero/i.test(message)) return { statusCode: 400, message };
  return { statusCode: 500, message };
}

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const httpError = mapErrorToHttp(error);
  res.status(httpError.statusCode).json({ error: httpError.message, details: httpError.details });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(attachUser);
  app.get('/healthz', (_req: Request, res: Response) => res.json({ ok: true, at: new Date().toISOString() }));

  const api = express.Router();
  api.use(requireAuth, asyncRoute(requireActiveUser as AsyncHandler));
  api.use('/menu', buildMenuRouter());
  api.use('/orders', buildOrdersRouter());
  api.use('/kds', buildKdsRouter());
  api.use('/billing', buildBillingRouter());
  api.use('/inventory', buildInventoryRouter());
  api.use('/reports', buildReportsRouter());
  api.use('/audit', buildAuditRouter());
  api.use('/users', buildUsersRouter());
  api.use('/settings', buildSettingsRouter());

  app.use('/api', api);
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
