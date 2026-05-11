declare const process: { env: Record<string, string | undefined> };

export interface BranchLocationSettings {
  /** Stable reporting partition key for the restaurant branch/location. */
  branchId: string;
  /** Human-readable branch name shown in manager-facing UI and exports. */
  branchName: string;
  /** Optional physical address or mall/floor label for receipt/report context. */
  locationLabel?: string;
}

export interface LanReconnectPolicy {
  /** Initial delay before retrying a failed LAN request or socket reconnect. */
  initialDelayMs: number;
  /** Maximum delay between reconnect attempts after exponential backoff. */
  maxDelayMs: number;
  /** Random jitter applied to avoid every terminal retrying at the same instant. */
  jitterMs: number;
  /** Maximum retry attempts for non-idempotent operations without an idempotency key. */
  maxUnsafeRetryAttempts: number;
  /** Maximum retry attempts for read requests and writes carrying an idempotency key. */
  maxSafeRetryAttempts: number;
  /** Interval for lightweight health checks after the client enters degraded/offline mode. */
  healthCheckIntervalMs: number;
}

export interface RuntimeSettings {
  branch: BranchLocationSettings;
  lanReconnect: LanReconnectPolicy;
}

const DEFAULT_BRANCH_ID = 'main';

function normalizeBranchId(value: string | undefined, fallback = DEFAULT_BRANCH_ID): string {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRuntimeSettings(env: Record<string, string | undefined> = process.env): RuntimeSettings {
  return {
    branch: {
      branchId: normalizeBranchId(env.POS_BRANCH_ID ?? env.RESTAURANT_BRANCH_ID),
      branchName: env.POS_BRANCH_NAME?.trim() || env.RESTAURANT_BRANCH_NAME?.trim() || 'Main Branch',
      locationLabel: env.POS_LOCATION_LABEL?.trim() || env.RESTAURANT_LOCATION_LABEL?.trim() || undefined,
    },
    lanReconnect: {
      initialDelayMs: parsePositiveInteger(env.POS_RECONNECT_INITIAL_DELAY_MS, 500),
      maxDelayMs: parsePositiveInteger(env.POS_RECONNECT_MAX_DELAY_MS, 10_000),
      jitterMs: parsePositiveInteger(env.POS_RECONNECT_JITTER_MS, 250),
      maxUnsafeRetryAttempts: parsePositiveInteger(env.POS_RETRY_MAX_UNSAFE_ATTEMPTS, 1),
      maxSafeRetryAttempts: parsePositiveInteger(env.POS_RETRY_MAX_SAFE_ATTEMPTS, 6),
      healthCheckIntervalMs: parsePositiveInteger(env.POS_HEALTH_CHECK_INTERVAL_MS, 5_000),
    },
  };
}

export function getCurrentBranchId(): string {
  return getRuntimeSettings().branch.branchId;
}

export function withCurrentBranch<T extends { branchId?: string }>(record: T): T & { branchId: string } {
  return {
    ...record,
    branchId: normalizeBranchId(record.branchId, getCurrentBranchId()),
  };
}
