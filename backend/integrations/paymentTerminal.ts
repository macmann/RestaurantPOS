import type { PaymentMethod } from '../billing/repository';

export type ExternalPaymentRail = 'card' | 'wallet' | 'bank_transfer';
export type PaymentAuthorizationStatus = 'authorized' | 'declined';
export type PaymentCaptureStatus = 'captured' | 'failed';
export type PaymentRefundStatus = 'refunded' | 'failed';
export type PaymentVoidStatus = 'voided' | 'failed';

export interface PaymentTerminalMoney {
  amount: number;
  currency: string;
}

export interface PaymentTerminalContext {
  branchId: string;
  tableSessionId: string;
  splitLabel: string;
  billId: string;
  actorUserId: string;
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentAuthorizationRequest extends PaymentTerminalMoney, PaymentTerminalContext {}

export interface PaymentAuthorizationResult {
  status: PaymentAuthorizationStatus;
  provider: string;
  rail: ExternalPaymentRail;
  authorizationId: string;
  reference: string;
  authorizedAt: string;
  declineReason?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentCaptureRequest extends PaymentTerminalMoney, PaymentTerminalContext {
  authorizationId: string;
}

export interface PaymentCaptureResult {
  status: PaymentCaptureStatus;
  provider: string;
  authorizationId: string;
  captureId: string;
  reference: string;
  capturedAt: string;
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentRefundRequest extends PaymentTerminalMoney, PaymentTerminalContext {
  captureId: string;
  originalPaymentId: string;
  reason: string;
}

export interface PaymentRefundResult {
  status: PaymentRefundStatus;
  provider: string;
  captureId: string;
  refundId: string;
  reference: string;
  refundedAt: string;
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentVoidRequest extends PaymentTerminalContext {
  authorizationId?: string;
  captureId?: string;
  originalPaymentId: string;
  reason: string;
}

export interface PaymentVoidResult {
  status: PaymentVoidStatus;
  provider: string;
  voidId: string;
  reference: string;
  voidedAt: string;
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentTerminalAdapter {
  readonly id: string;
  authorize(request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult>;
  capture(request: PaymentCaptureRequest): Promise<PaymentCaptureResult>;
  refund(request: PaymentRefundRequest): Promise<PaymentRefundResult>;
  voidPayment(request: PaymentVoidRequest): Promise<PaymentVoidResult>;
}

function createSimulatorId(prefix: string, seed: string): string {
  const normalized = seed.replace(/[^a-zA-Z0-9_-]/g, '').slice(-20) || Math.random().toString(36).slice(2, 10);
  return `sim_${prefix}_${normalized}`;
}

function inferRail(method: PaymentMethod): ExternalPaymentRail {
  if (method === 'card') return 'card';
  if (method === 'bank_transfer') return 'bank_transfer';
  return 'wallet';
}

export class SimulatorPaymentTerminalAdapter implements PaymentTerminalAdapter {
  readonly id = 'simulator-payment-terminal';
  readonly events: Array<{ type: string; payload: Record<string, unknown> }> = [];

  async authorize(request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult> {
    const authorizedAt = new Date().toISOString();
    const result: PaymentAuthorizationResult = {
      status: 'authorized',
      provider: this.id,
      rail: inferRail(request.paymentMethod),
      authorizationId: createSimulatorId('auth', request.idempotencyKey),
      reference: `SIM-AUTH-${request.idempotencyKey}`,
      authorizedAt,
      raw: { simulator: true },
    };
    this.events.push({ type: 'authorize', payload: { ...request, result } });
    return result;
  }

  async capture(request: PaymentCaptureRequest): Promise<PaymentCaptureResult> {
    const capturedAt = new Date().toISOString();
    const result: PaymentCaptureResult = {
      status: 'captured',
      provider: this.id,
      authorizationId: request.authorizationId,
      captureId: createSimulatorId('cap', `${request.authorizationId}_${request.idempotencyKey}`),
      reference: `SIM-CAP-${request.idempotencyKey}`,
      capturedAt,
      raw: { simulator: true },
    };
    this.events.push({ type: 'capture', payload: { ...request, result } });
    return result;
  }

  async refund(request: PaymentRefundRequest): Promise<PaymentRefundResult> {
    const refundedAt = new Date().toISOString();
    const result: PaymentRefundResult = {
      status: 'refunded',
      provider: this.id,
      captureId: request.captureId,
      refundId: createSimulatorId('refund', `${request.captureId}_${request.idempotencyKey}`),
      reference: `SIM-REFUND-${request.idempotencyKey}`,
      refundedAt,
      raw: { simulator: true, reason: request.reason },
    };
    this.events.push({ type: 'refund', payload: { ...request, result } });
    return result;
  }

  async voidPayment(request: PaymentVoidRequest): Promise<PaymentVoidResult> {
    const voidedAt = new Date().toISOString();
    const result: PaymentVoidResult = {
      status: 'voided',
      provider: this.id,
      voidId: createSimulatorId('void', `${request.originalPaymentId}_${request.idempotencyKey}`),
      reference: `SIM-VOID-${request.idempotencyKey}`,
      voidedAt,
      raw: { simulator: true, reason: request.reason },
    };
    this.events.push({ type: 'void', payload: { ...request, result } });
    return result;
  }
}

let paymentTerminalAdapter: PaymentTerminalAdapter = new SimulatorPaymentTerminalAdapter();

export function getPaymentTerminalAdapter(): PaymentTerminalAdapter {
  return paymentTerminalAdapter;
}

export function setPaymentTerminalAdapter(adapter: PaymentTerminalAdapter): void {
  paymentTerminalAdapter = adapter;
}

export function resetPaymentTerminalAdapter(): SimulatorPaymentTerminalAdapter {
  const adapter = new SimulatorPaymentTerminalAdapter();
  paymentTerminalAdapter = adapter;
  return adapter;
}
