export interface LanReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  maxUnsafeRetryAttempts: number;
  maxSafeRetryAttempts: number;
  healthCheckIntervalMs: number;
}

export type LanOperationKind = 'read' | 'idempotent_write' | 'unsafe_write';

export const DEFAULT_LAN_RECONNECT_POLICY: LanReconnectPolicy = {
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  jitterMs: 250,
  maxUnsafeRetryAttempts: 1,
  maxSafeRetryAttempts: 6,
  healthCheckIntervalMs: 5_000,
};

export function maxAttemptsForOperation(kind: LanOperationKind, policy: LanReconnectPolicy = DEFAULT_LAN_RECONNECT_POLICY): number {
  return kind === 'unsafe_write' ? policy.maxUnsafeRetryAttempts : policy.maxSafeRetryAttempts;
}

export function reconnectDelayMs(attempt: number, policy: LanReconnectPolicy = DEFAULT_LAN_RECONNECT_POLICY): number {
  const exponent = Math.max(0, attempt - 1);
  const baseDelay = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** exponent);
  const jitter = policy.jitterMs > 0 ? Math.floor(Math.random() * policy.jitterMs) : 0;
  return baseDelay + jitter;
}

export function shouldRetryLanFailure(kind: LanOperationKind, attempt: number, policy: LanReconnectPolicy = DEFAULT_LAN_RECONNECT_POLICY): boolean {
  return attempt < maxAttemptsForOperation(kind, policy);
}
