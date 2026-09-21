import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type ProcessEnvironment = Record<string, string | undefined>;

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
