import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type ProcessEnvironment = Record<string, string | undefined>;

export type AppMode = 'POS' | 'CLOUD';

/** The single authoritative deployment-mode check (MANAGER is a CLOUD alias). */
export function readAppMode(environment: ProcessEnvironment = process.env): AppMode {
  const value = (environment.APP_MODE ?? 'POS').trim().toUpperCase();
  if (value === 'MANAGER') return 'CLOUD';
  if (value !== 'POS' && value !== 'CLOUD') throw new Error(`Unsupported APP_MODE '${environment.APP_MODE}'. Expected POS or CLOUD (MANAGER is accepted as a cloud alias).`);
  return value;
}

export function isCloudDeployment(environment: ProcessEnvironment = process.env): boolean {
  return readAppMode(environment) === 'CLOUD';
}

/** Parse the subset of dotenv syntax used by the application's deployment template. */
export function parseEnvironmentFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2] ?? '';
    if (value.startsWith('"')) {
      const quoted = value.match(/^"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/);
      if (!quoted) continue;
      value = quoted[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } else if (value.startsWith("'")) {
      const quoted = value.match(/^'([^']*)'\s*(?:#.*)?$/);
      if (!quoted) continue;
      value = quoted[1];
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[key] = value;
  }

  return values;
}

/** Load a project-root .env file without replacing variables supplied by the host. */
export function loadLocalEnvironment(
  filePath = resolve(process.cwd(), '.env'),
  environment: ProcessEnvironment = process.env,
): void {
  if (!existsSync(filePath)) return;

  const values = parseEnvironmentFile(readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (environment[key] === undefined) environment[key] = value;
  }
}

loadLocalEnvironment();
