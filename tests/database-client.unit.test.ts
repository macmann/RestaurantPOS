import assert from 'node:assert/strict';
import { createPoolConfig, type DatabaseClient, type PoolLike, withTransaction } from '../backend/db/client';

class TransactionClient implements DatabaseClient {
  readonly statements: string[] = [];
  private localSettings = new Map<string, string>();
  released = false;

  async query<Row = Record<string, unknown>>(text: string): Promise<{ rows: Row[]; rowCount: number }> {
    this.statements.push(text);
    const setting = text.match(/^SET LOCAL ([\w.]+) = '([A-Z_]+)'$/);
    if (setting) this.localSettings.set(setting[1], setting[2]);
    if (text === 'COMMIT' || text === 'ROLLBACK') this.localSettings.clear();
    return { rows: [] as Row[], rowCount: 0 };
  }

  setting(name: string): string | undefined {
    return this.localSettings.get(name);
  }

  release(): void {
    this.released = true;
  }
}

class ReusedConnectionPool implements PoolLike {
  readonly client = new TransactionClient();

  async connect(): Promise<DatabaseClient> {
    return this.client;
  }

  async query<Row = Record<string, unknown>>(): Promise<{ rows: Row[]; rowCount: number }> {
    return { rows: [] as Row[], rowCount: 0 };
  }

  async end(): Promise<void> {}
}

async function run(): Promise<void> {
  const previousBackend = process.env.POS_REPOSITORY_BACKEND;
  const previousMode = process.env.APP_MODE;
  process.env.POS_REPOSITORY_BACKEND = 'postgres';

  try {
    const poolConfig = createPoolConfig({
      DATABASE_URL: 'postgresql://user:password@pooled.neon.tech/app?sslmode=require',
    });
    assert.equal('options' in poolConfig, false, 'pooled connections must not receive startup GUC options');
    assert.equal(poolConfig.connectionString, 'postgresql://user:password@pooled.neon.tech/app?sslmode=require');

    const pool = new ReusedConnectionPool();
    for (const mode of ['POS', 'CLOUD'] as const) {
      process.env.APP_MODE = mode;
      await withTransaction(async (client) => {
        assert.equal(pool.client.setting('restaurant_pos.app_mode'), mode);
        if (mode === 'CLOUD') {
          await client.query("SET LOCAL restaurant_pos.sync_origin = 'CLOUD_MANAGER'");
          assert.equal(pool.client.setting('restaurant_pos.sync_origin'), 'CLOUD_MANAGER');
        }
      }, pool);
      assert.equal(pool.client.setting('restaurant_pos.app_mode'), undefined);
      assert.equal(pool.client.setting('restaurant_pos.sync_origin'), undefined);
    }

    assert.deepEqual(pool.client.statements, [
      'BEGIN',
      "SET LOCAL restaurant_pos.app_mode = 'POS'",
      'COMMIT',
      'BEGIN',
      "SET LOCAL restaurant_pos.app_mode = 'CLOUD'",
      "SET LOCAL restaurant_pos.sync_origin = 'CLOUD_MANAGER'",
      'COMMIT',
    ]);

    process.env.APP_MODE = 'invalid';
    await assert.rejects(withTransaction(async () => undefined, pool), /Expected POS or CLOUD/);
    assert.equal(pool.client.statements.at(-1), 'ROLLBACK');
  } finally {
    if (previousBackend === undefined) delete process.env.POS_REPOSITORY_BACKEND;
    else process.env.POS_REPOSITORY_BACKEND = previousBackend;
    if (previousMode === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = previousMode;
  }

  console.log('Database client unit test passed.');
}

void run();
