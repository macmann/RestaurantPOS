import { isSqlRepositoryEnabled, query, readDatabaseConfig } from '../db/client';

export type MonitorState = 'operational' | 'unavailable' | 'not_configured';

export interface SystemStatus {
  checkedAt: string;
  api: { status: 'operational'; uptimeSeconds: number; detail: string };
  database: {
    status: MonitorState;
    backend: 'postgres' | 'memory';
    target: string;
    latencyMs?: number;
    detail: string;
  };
}

/** Perform a real database round trip when PostgreSQL persistence is enabled. */
export async function getSystemStatus(): Promise<SystemStatus> {
  const checkedAt = new Date().toISOString();
  const api = {
    status: 'operational' as const,
    uptimeSeconds: Math.floor(process.uptime()),
    detail: 'The API responded to this live status request.',
  };

  if (!isSqlRepositoryEnabled()) {
    return {
      checkedAt,
      api,
      database: {
        status: 'not_configured',
        backend: 'memory',
        target: 'In-process memory',
        detail: 'PostgreSQL persistence is not enabled; data is stored in memory and will not survive a restart.',
      },
    };
  }

  const config = readDatabaseConfig();
  const target = `${config.host}:${config.port}/${config.database}`;
  const startedAt = Date.now();
  try {
    await query('SELECT 1 AS connected');
    return {
      checkedAt,
      api,
      database: {
        status: 'operational', backend: 'postgres', target,
        latencyMs: Date.now() - startedAt,
        detail: 'A live PostgreSQL query completed successfully.',
      },
    };
  } catch (error) {
    return {
      checkedAt,
      api,
      database: {
        status: 'unavailable', backend: 'postgres', target,
        latencyMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.message : 'The PostgreSQL connection check failed.',
      },
    };
  }
}
