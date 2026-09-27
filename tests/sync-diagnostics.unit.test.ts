import assert from 'node:assert/strict';
import { resolvedSyncEndpoints, SYNC_ENDPOINTS } from '../backend/sync/config';
import { assertLocalMenuStoreAlignment, countMenuRecords, findMenuMismatches, sanitizeSyncDiagnosticText, syncSuggestedAction } from '../backend/sync/worker';

function run(): void {
  const endpoints = resolvedSyncEndpoints({ cloudSyncBaseUrl: 'https://cloud.example.com' });
  assert.deepEqual(endpoints.pull, { ...SYNC_ENDPOINTS.pull, url: 'https://cloud.example.com/cloud/sync/incoming' });
  assert.equal(endpoints.acknowledgement.url, 'https://cloud.example.com/cloud/sync/incoming/ack');
  assert.deepEqual(endpoints.menuReconcile, { ...SYNC_ENDPOINTS.menuReconcile, url: 'https://cloud.example.com/cloud/sync/menu/reconcile' });
  assert.match(syncSuggestedAction(401), /Token was rejected/);
  assert.match(syncSuggestedAction(404), /did not recognize.*endpoint/);
  assert.match(syncSuggestedAction(500), /server error/);
  assert.match(syncSuggestedAction(undefined, 'TIMEOUT'), /timeout/);
  const secret = 'do-not-display-this-token';
  const sanitized = sanitizeSyncDiagnosticText(`Not Found; Authorization=Bearer ${secret}; token=${secret}; password=${secret}`);
  assert.equal(sanitized.includes(secret), false, 'Diagnostic text must not retain secrets.');
  assert.ok(sanitizeSyncDiagnosticText('x'.repeat(800)).length <= 500, 'Diagnostic bodies must be length limited.');
  const category = { entityType: 'menu_categories' as const, payload: { id: 'cat-1', branchId: 'main-floor', updatedAt: '2026-09-27T00:00:00Z' } };
  const item = { entityType: 'menu_items' as const, payload: { id: 'item-1', branchId: 'main-floor', deletedAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z' } };
  assert.deepEqual(countMenuRecords([category, item]), { total: 2, categories: 1, items: 1, active: 1, tombstones: 1 });
  assert.deepEqual(findMenuMismatches([category], [{ ...category, payload: { updatedAt: category.payload.updatedAt, branchId: 'main-floor', id: 'cat-1' } }]), []);
  assert.deepEqual(findMenuMismatches([category], [{ ...category, payload: { ...category.payload, name: 'Cloud name' } }]), ['menu_categories:cat-1']);
  assert.doesNotThrow(() => assertLocalMenuStoreAlignment('main-floor', 2, ['legacy-store']));
  assert.doesNotThrow(() => assertLocalMenuStoreAlignment('main-floor', 0, ['main-floor']));
  assert.throws(
    () => assertLocalMenuStoreAlignment('main-floor', 0, ['legacy-store']),
    /No local menu records belong to configured Store ID 'main-floor'.*legacy-store/,
  );
  console.log('Sync diagnostics unit test passed.');
}
run();
