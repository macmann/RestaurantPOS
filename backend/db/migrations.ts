declare const require: (name: string) => unknown;
declare const __dirname: string;
declare const process: { cwd(): string };

const { readFile } = require('fs/promises') as { readFile(path: string, encoding: string): Promise<string> };
const path = require('path') as { resolve(...parts: string[]): string };
import { query, withTransaction } from './client';
import { ensureRepositoryStore } from './repositoryStore';

export const INITIAL_MIGRATION_ID = '20260505140000_initial_restaurantpos_schema';
const INITIAL_MIGRATION_FILE = path.resolve(process.cwd(), 'schema/migrations/20260505140000_initial_restaurantpos_schema.sql');

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasMigration(id: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE id = $1) AS exists', [id]);
  return result.rows[0]?.exists === true;
}

export async function runInitialRestaurantPosMigration(): Promise<void> {
  await ensureMigrationsTable();
  if (await hasMigration(INITIAL_MIGRATION_ID)) {
    await ensureRepositoryStore();
    return;
  }

  const sql = (await readFile(INITIAL_MIGRATION_FILE, 'utf8')).replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
  await withTransaction(async (client) => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [INITIAL_MIGRATION_ID]);
  });
  await ensureRepositoryStore();
}
