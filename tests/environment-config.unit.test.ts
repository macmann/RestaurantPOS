import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalEnvironment, parseEnvironmentFile } from '../backend/config/environment';

function run(): void {
  assert.deepEqual(
    parseEnvironmentFile(`
      DATABASE_URL="postgresql://posuser:secret@localhost:5432/pos"
      export DB_SSL=true # managed database
      EMPTY=
      SINGLE='literal # value'
    `),
    {
      DATABASE_URL: 'postgresql://posuser:secret@localhost:5432/pos',
      DB_SSL: 'true',
      EMPTY: '',
      SINGLE: 'literal # value',
    },
  );

  const directory = mkdtempSync(join(tmpdir(), 'restaurant-pos-env-'));
  const filePath = join(directory, '.env');
  try {
    writeFileSync(filePath, 'DATABASE_URL="postgresql://from-file/db"\nPOS_REPOSITORY_BACKEND=postgres\n');
    const environment: Record<string, string | undefined> = { DATABASE_URL: 'postgresql://from-host/db' };
    loadLocalEnvironment(filePath, environment);
    assert.equal(environment.DATABASE_URL, 'postgresql://from-host/db');
    assert.equal(environment.POS_REPOSITORY_BACKEND, 'postgres');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  console.log('Environment configuration unit test passed.');
}

run();
