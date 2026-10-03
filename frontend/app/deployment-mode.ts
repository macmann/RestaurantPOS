export type DeploymentMode = 'POS' | 'CLOUD';

export interface DeploymentCapabilities {
  operationalWrite: boolean;
  menuWrite: boolean;
  localHardware: boolean;
  localSyncConfiguration: boolean;
}

export interface RuntimeCapabilities {
  deploymentMode: DeploymentMode;
  capabilities: DeploymentCapabilities;
  cloudMonitorRefreshMs: number;
}

const safeInitialState: RuntimeCapabilities = {
  deploymentMode: 'CLOUD',
  capabilities: { operationalWrite: false, menuWrite: false, localHardware: false, localSyncConfiguration: false },
  cloudMonitorRefreshMs: 60_000,
};

let runtime = safeInitialState;
let loadPromise: Promise<RuntimeCapabilities> | undefined;

export function setDeploymentRuntime(value: RuntimeCapabilities): void {
  runtime = value;
}

export function deploymentRuntime(): RuntimeCapabilities { return runtime; }
export function isCloudDeployment(): boolean { return runtime.deploymentMode === 'CLOUD'; }
export function isOperationalReadOnly(): boolean { return !runtime.capabilities.operationalWrite; }
export function canPerformOperationalWrite(): boolean { return runtime.capabilities.operationalWrite; }

export function loadDeploymentRuntime(loader: () => Promise<RuntimeCapabilities>): Promise<RuntimeCapabilities> {
  loadPromise ??= loader().then((value) => {
    setDeploymentRuntime(value);
    return value;
  }).catch((error) => {
    loadPromise = undefined;
    throw error;
  });
  return loadPromise;
}

export function resetDeploymentRuntimeForTests(): void {
  runtime = safeInitialState;
  loadPromise = undefined;
}

