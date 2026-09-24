import assert from 'node:assert/strict';
import { isCloudDeployment, readAppMode } from '../backend/config/environment';
import { getCloudConnectionInformation, normalizePublicBaseUrl, resolvePublicBaseUrl } from '../backend/config/cloudConnection';
import { localSyncWorkerAllowed } from '../backend/sync/worker';
import { loadSyncConfig, validateSyncSettings } from '../backend/sync/config';

async function run(): Promise<void> {
  assert.equal(readAppMode({ APP_MODE: 'POS' }), 'POS');
  assert.equal(isCloudDeployment({ APP_MODE: 'CLOUD' }), true);
  assert.equal(isCloudDeployment({ APP_MODE: 'MANAGER' }), true);
  assert.equal(localSyncWorkerAllowed({ APP_MODE: 'CLOUD' }), false, 'Cloud must never start the outbound POS worker.');
  assert.equal(localSyncWorkerAllowed({ APP_MODE: 'POS' }), true);
  const production = { NODE_ENV: 'production' };
  assert.equal(normalizePublicBaseUrl('https://sym-pos.onrender.com/', production), 'https://sym-pos.onrender.com');
  assert.equal(resolvePublicBaseUrl({ ...production, PUBLIC_BASE_URL: 'https://explicit.example/', RENDER_EXTERNAL_HOSTNAME: 'fallback.onrender.com' }), 'https://explicit.example');
  assert.equal(resolvePublicBaseUrl({ ...production, RENDER_EXTERNAL_HOSTNAME: 'fallback.onrender.com' }), 'https://fallback.onrender.com');
  for (const invalid of ['localhost:10000', 'https://user:password@example.com', 'https://example.com/api/sync/events', 'https://example.com?token=abc', 'https://example.com#secret', 'http://example.com']) assert.throws(() => normalizePublicBaseUrl(invalid, production));
  assert.equal(normalizePublicBaseUrl('http://localhost:10000/', { NODE_ENV: 'development' }), 'http://localhost:10000');
  const previousBackend = process.env.POS_REPOSITORY_BACKEND;
  process.env.POS_REPOSITORY_BACKEND = 'memory';
  try {
    const previousBranch = process.env.POS_BRANCH_ID;
    const previousStore = process.env.POS_STORE_ID;
    process.env.POS_BRANCH_ID = 'branch-east';
    delete process.env.POS_STORE_ID;
    assert.equal((await loadSyncConfig()).storeId, 'branch-east', 'Incoming polling must default to the branch used by menu records.');
    assert.throws(() => validateSyncSettings({ enabled: true, cloudSyncBaseUrl: 'https://cloud.example.com', storeId: 'different-store', deviceId: 'pos-1', pushIntervalMs: 5000, pollIntervalMs: 5000, requestTimeoutMs: 1000, batchSize: 10, successRetentionDays: 30 }), /must match this POS branch ID/);
    if (previousBranch === undefined) delete process.env.POS_BRANCH_ID; else process.env.POS_BRANCH_ID = previousBranch;
    if (previousStore === undefined) delete process.env.POS_STORE_ID; else process.env.POS_STORE_ID = previousStore;
    const token = 'raw-secret-that-must-never-leak';
    const info = await getCloudConnectionInformation({ APP_MODE: 'CLOUD', NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://sym-pos.onrender.com/', SYNC_API_TOKEN: token, POS_STORE_ID: 'restaurant-yangon-downtown-with-a-long-identifier' });
    assert.equal(info.publicBaseUrl, 'https://sym-pos.onrender.com');
    assert.equal(info.tokenConfigured, true);
    assert.equal(info.status, 'DATABASE_UNAVAILABLE');
    assert.equal(JSON.stringify(info).includes(token), false);
    assert.equal(info.endpoints.push.path, '/cloud/sync/events');
    assert.equal(info.publicBaseUrl.includes('/cloud/sync/'), false);
    assert.equal(info.storeId.value, 'restaurant-yangon-downtown-with-a-long-identifier');
    assert.equal((await getCloudConnectionInformation({ APP_MODE: 'CLOUD', POS_BRANCH_ID: 'Branch East' })).storeId.value, 'branch-east', 'The branch ID is the Store ID fallback shown to cloud administrators.');
    assert.equal((await getCloudConnectionInformation({ APP_MODE: 'CLOUD', NODE_ENV: 'production' })).status, 'NOT_CONFIGURED');
  } finally {
    if (previousBackend === undefined) delete process.env.POS_REPOSITORY_BACKEND;
    else process.env.POS_REPOSITORY_BACKEND = previousBackend;
  }
  console.log('Cloud connection unit test passed.');
}
void run();
