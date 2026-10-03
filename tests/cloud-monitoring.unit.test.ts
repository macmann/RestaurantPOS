import assert from 'node:assert/strict';
import { CloudMonitorRefreshController, type RefreshScheduler } from '../frontend/app/cloud-monitor-refresh';
import { canPerformOperationalWrite, isCloudDeployment, resetDeploymentRuntimeForTests, setDeploymentRuntime } from '../frontend/app/deployment-mode';

async function run(): Promise<void> {
  resetDeploymentRuntimeForTests();
  assert.equal(canPerformOperationalWrite(), false, 'Bootstrap must fail closed until server capabilities load.');
  setDeploymentRuntime({ deploymentMode: 'CLOUD', capabilities: { operationalWrite: false, menuWrite: true, localHardware: false, localSyncConfiguration: false }, cloudMonitorRefreshMs: 60_000 });
  assert.equal(isCloudDeployment(), true);
  assert.equal(canPerformOperationalWrite(), false);

  let scheduled: (() => void) | undefined;
  let clearCount = 0;
  const scheduler: RefreshScheduler = {
    setTimeout: (callback) => { scheduled = callback; return 1; },
    clearTimeout: () => { clearCount += 1; scheduled = undefined; },
  };
  let release: (() => void) | undefined;
  let calls = 0;
  const controller = new CloudMonitorRefreshController(() => {
    calls += 1;
    return new Promise<void>((resolve) => { release = resolve; });
  }, 60_000, true, scheduler, () => true);
  controller.start();
  assert.ok(scheduled, 'Cloud polling should schedule an active-screen refresh.');
  const first = controller.run();
  await controller.run();
  assert.equal(calls, 1, 'Overlapping refreshes must be suppressed.');
  release!();
  await first;
  assert.ok(scheduled, 'A completed refresh should schedule the next poll.');
  controller.stop();
  assert.ok(clearCount > 0);

  setDeploymentRuntime({ deploymentMode: 'POS', capabilities: { operationalWrite: true, menuWrite: true, localHardware: true, localSyncConfiguration: true }, cloudMonitorRefreshMs: 60_000 });
  assert.equal(canPerformOperationalWrite(), true, 'POS capabilities must preserve operational writes.');
  console.log('cloud-monitoring.unit: ok');
}

void run();
