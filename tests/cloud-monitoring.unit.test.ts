import assert from 'node:assert/strict';
import { Actions, RolePermissions } from '../backend/auth/permissions';
import { appRoutes, canAccessRoute, visibleRoutes, superadminSettingsRoutes } from '../frontend/auth/navigation';
import { CloudMonitorRefreshController, type RefreshScheduler } from '../frontend/app/cloud-monitor-refresh';
import { canPerformOperationalWrite, isCloudDeployment, resetDeploymentRuntimeForTests, setDeploymentRuntime } from '../frontend/app/deployment-mode';

async function run(): Promise<void> {
  resetDeploymentRuntimeForTests();
  assert.equal(canPerformOperationalWrite(), false, 'Bootstrap must fail closed until server capabilities load.');
  setDeploymentRuntime({ deploymentMode: 'CLOUD', capabilities: { operationalWrite: false, menuWrite: true, localHardware: false, localSyncConfiguration: false }, cloudMonitorRefreshMs: 60_000 });
  assert.equal(isCloudDeployment(), true);
  assert.equal(canPerformOperationalWrite(), false);

  const cloudCapabilities = { localHardware: false, localSyncConfiguration: false };
  const superadmin = RolePermissions.superadmin;
  const cloudRoutes = visibleRoutes(superadmin, cloudCapabilities);
  assert.ok(cloudRoutes.some((route) => route.path === '#/superadmin'), 'Cloud superadmin navigation must expose the panel.');
  assert.ok(visibleRoutes([Actions.ManageSystem], cloudCapabilities).some((route) => route.path === '#/superadmin'), 'ManageSystem alone must grant panel access.');
  assert.ok(!visibleRoutes(RolePermissions.manager, cloudCapabilities).some((route) => route.path === '#/superadmin'), 'Cloud mode must not grant managers superadmin access.');
  const panelRoute = appRoutes.find((route) => route.path === '#/superadmin')!;
  assert.equal(panelRoute.localOnly, undefined, 'Direct cloud panel links must not redirect as local-only.');
  assert.equal(canAccessRoute(panelRoute, []), false);
  const settingsRoutes = superadminSettingsRoutes(superadmin);
  assert.equal(settingsRoutes.find((route) => route.path === '#/cloud-sync-settings')?.localOnly, undefined, 'Cloud connection information must be reachable.');
  assert.equal(settingsRoutes.find((route) => route.path === '#/bill-settings')?.localOnly, true, 'Local printer configuration must remain local-only.');
  assert.ok(visibleRoutes(superadmin, { localHardware: true, localSyncConfiguration: true }).some((route) => route.path === '#/superadmin'), 'Local panel access must remain available.');

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
