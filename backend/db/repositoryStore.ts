import { query } from './client';

export type RepositoryNamespace = 'orders' | 'billing:bills' | 'billing:debt' | 'billing:audit' | 'inventory:items' | 'inventory:movements' | 'menu:categories' | 'menu:items' | 'kds:items' | 'audit:events' | 'users' | 'auth:sessions' | 'tables' | 'table:sessions';

export interface StoredRecord<T> {
  namespace: RepositoryNamespace;
  recordKey: string;
  payload: T;
  createdAt: string;
  updatedAt: string;
}

export async function ensureRepositoryStore(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS repository_records (
      namespace TEXT NOT NULL,
      record_key TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (namespace, record_key)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_repository_records_payload_gin ON repository_records USING GIN (payload)`);
}

export async function putRecord<T extends object>(namespace: RepositoryNamespace, recordKey: string, payload: T): Promise<T> {
  await ensureRepositoryStore();
  const now = new Date().toISOString();
  await query(
    `INSERT INTO repository_records (namespace, record_key, payload, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $4)
     ON CONFLICT (namespace, record_key)
     DO UPDATE SET payload = EXCLUDED.payload, updated_at = $4`,
    [namespace, recordKey, JSON.stringify(payload), now],
  );
  return structuredClone(payload);
}

export async function getRecord<T>(namespace: RepositoryNamespace, recordKey: string): Promise<T | null> {
  await ensureRepositoryStore();
  const result = await query<{ payload: T }>('SELECT payload FROM repository_records WHERE namespace = $1 AND record_key = $2', [namespace, recordKey]);
  return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : null;
}

export async function deleteRecord(namespace: RepositoryNamespace, recordKey: string): Promise<boolean> {
  await ensureRepositoryStore();
  const result = await query('DELETE FROM repository_records WHERE namespace = $1 AND record_key = $2', [namespace, recordKey]);
  return (result.rowCount ?? 0) > 0;
}

export async function listRecords<T>(namespace: RepositoryNamespace): Promise<T[]> {
  await ensureRepositoryStore();
  const result = await query<{ payload: T }>('SELECT payload FROM repository_records WHERE namespace = $1', [namespace]);
  return result.rows.map((row) => structuredClone(row.payload));
}

export async function clearRepositoryStore(): Promise<void> {
  await ensureRepositoryStore();
  await query('DELETE FROM repository_records');
}
