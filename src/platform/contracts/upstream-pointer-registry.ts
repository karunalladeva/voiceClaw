export interface UpstreamRegistryEntry {
  blockerTaskId: string;
  pointerId: string;
  title: string;
  summary: string;
  status: 'done' | 'review';
}

export interface UpstreamPointerRegistry {
  schemaVersion: 1;
  rootTaskId: string;
  taskId: string;
  entries: UpstreamRegistryEntry[];
  updatedAt: string;
}

export const UPSTREAM_REGISTRY_FILENAME = 'upstream-registry.json';
