declare const require: (name: string) => unknown;
declare const process: { env: Record<string, string | undefined>; cwd(): string };

interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface DatabaseClient {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<Row>>;
  release?(): void;
}

interface PoolLike extends DatabaseClient {
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
}

export interface DatabaseConfig {
  client: 'postgres';
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

type PgPoolConstructor = new (config: Record<string, unknown>) => PoolLike;
type AsyncLocalStorageLike<T> = {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
};

type ProcessEnv = Record<string, string | undefined>;

let pool: PoolLike | null = null;
const { AsyncLocalStorage } = require('async_hooks') as { AsyncLocalStorage: new <T>() => AsyncLocalStorageLike<T> };
const txStorage = new AsyncLocalStorage<DatabaseClient>();

export function readDatabaseConfig(env: ProcessEnv = process.env): DatabaseConfig {
  const client = env.DB_CLIENT ?? 'postgres';
  if (client !== 'postgres') throw new Error(`Unsupported DB_CLIENT '${client}'. Only postgres is supported.`);

  return {
    client,
    host: env.DB_HOST ?? '127.0.0.1',
    port: Number.parseInt(env.DB_PORT ?? '5432', 10),
    database: env.DB_NAME ?? 'restaurant_pos',
    user: env.DB_USER ?? 'pos_user',
    password: env.DB_PASSWORD ?? '',
    ssl: (env.DB_SSL ?? 'false').toLowerCase() === 'true',
  };
}

function requirePgPool(): PgPoolConstructor {
  const pg = require('pg') as { Pool: PgPoolConstructor };
  return pg.Pool;
}

export function isSqlRepositoryEnabled(): boolean {
  return (process.env.POS_REPOSITORY_BACKEND ?? process.env.RESTAURANTPOS_REPOSITORY_BACKEND ?? '').toLowerCase() === 'postgres';
}

export function getDatabasePool(): PoolLike {
  if (pool) return pool;
  const config = readDatabaseConfig();
  const Pool = requirePgPool();
  pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
  });
  return pool;
}

export function getCurrentDatabaseClient(): DatabaseClient {
  return txStorage.getStore() ?? getDatabasePool();
}

export async function query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<Row>> {
  return getCurrentDatabaseClient().query<Row>(text, params);
}

export async function withTransaction<T>(callback: (client: DatabaseClient) => Promise<T>): Promise<T> {
  if (!isSqlRepositoryEnabled()) {
    const noopClient: DatabaseClient = {
      async query() {
        throw new Error('Database query attempted while SQL repositories are disabled.');
      },
    };
    return callback(noopClient);
  }

  const existing = txStorage.getStore();
  if (existing) return callback(existing);

  const client = await getDatabasePool().connect();
  try {
    await client.query('BEGIN');
    const result = await txStorage.run(client, () => callback(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release?.();
  }
}

export async function closeDatabasePool(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}
