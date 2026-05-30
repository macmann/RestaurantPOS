import { createHash } from 'crypto';
import { isSqlRepositoryEnabled } from './db/client';
import { getRecord, putRecord } from './db/repositoryStore';

export interface IdempotencyRecord {
  key: string;
  userId?: string;
  method: string;
  path: string;
  bodyHash: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: string;
}

const records = new Map<string, IdempotencyRecord>();

function stableStringify(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

export function idempotencyBodyHash(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

export function idempotencyFingerprint(input: { userId?: string; method: string; path: string; body: unknown }) {
  return {
    userId: input.userId,
    method: input.method.toUpperCase(),
    path: input.path,
    bodyHash: idempotencyBodyHash(input.body),
  };
}

export async function getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
  if (isSqlRepositoryEnabled()) return getRecord<IdempotencyRecord>('network:idempotency', key);
  const record = records.get(key);
  return record ? structuredClone(record) : null;
}

export async function saveIdempotencyRecord(record: IdempotencyRecord): Promise<IdempotencyRecord> {
  if (isSqlRepositoryEnabled()) return putRecord('network:idempotency', record.key, record);
  records.set(record.key, structuredClone(record));
  return structuredClone(record);
}

export function idempotencyMatches(record: IdempotencyRecord, fingerprint: Omit<IdempotencyRecord, 'key' | 'statusCode' | 'responseBody' | 'createdAt'>): boolean {
  return record.userId === fingerprint.userId
    && record.method === fingerprint.method
    && record.path === fingerprint.path
    && record.bodyHash === fingerprint.bodyHash;
}
