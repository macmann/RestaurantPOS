import assert from 'node:assert/strict';
import { resolvedSyncEndpoints, SYNC_ENDPOINTS } from '../backend/sync/config';
import { sanitizeSyncDiagnosticText, syncSuggestedAction } from '../backend/sync/worker';

function run(): void {
  const endpoints = resolvedSyncEndpoints({ cloudSyncBaseUrl: 'https://cloud.example.com' });
  assert.deepEqual(endpoints.pull, { ...SYNC_ENDPOINTS.pull, url: 'https://cloud.example.com/cloud/sync/incoming' });
  assert.equal(endpoints.acknowledgement.url, 'https://cloud.example.com/cloud/sync/incoming/ack');
  assert.match(syncSuggestedAction(401), /Token was rejected/);
  assert.match(syncSuggestedAction(404), /did not recognize.*endpoint/);
  assert.match(syncSuggestedAction(500), /server error/);
  assert.match(syncSuggestedAction(undefined, 'TIMEOUT'), /timeout/);
  const secret = 'do-not-display-this-token';
  const sanitized = sanitizeSyncDiagnosticText(`Not Found; Authorization=Bearer ${secret}; token=${secret}; password=${secret}`);
  assert.equal(sanitized.includes(secret), false, 'Diagnostic text must not retain secrets.');
  assert.ok(sanitizeSyncDiagnosticText('x'.repeat(800)).length <= 500, 'Diagnostic bodies must be length limited.');
  console.log('Sync diagnostics unit test passed.');
}
run();
