import type { UpstreamPointerRegistry, UpstreamRegistryEntry } from '../contracts';
import { sessionContextService } from './session-context-service';

export async function mergeUpstreamRegistryEntry(
  scopeId: string,
  rootTaskId: string,
  taskId: string,
  entry: UpstreamRegistryEntry,
): Promise<UpstreamPointerRegistry> {
  const existing =
    (await sessionContextService.loadUpstreamRegistry(scopeId, taskId)) ?? {
      schemaVersion: 1 as const,
      rootTaskId,
      taskId,
      entries: [],
      updatedAt: new Date().toISOString(),
    };
  const without = existing.entries.filter((e) => e.blockerTaskId !== entry.blockerTaskId);
  const registry: UpstreamPointerRegistry = {
    ...existing,
    entries: [...without, entry],
    updatedAt: new Date().toISOString(),
  };
  await sessionContextService.saveUpstreamRegistry(scopeId, registry);
  return registry;
}

export function formatUpstreamRegistryForPrompt(registry: UpstreamPointerRegistry, maxChars = 3000): string {
  const lines = registry.entries.map(
    (e) => `- [${e.status}] ${e.title} (pointer:${e.pointerId}): ${e.summary.slice(0, 200)}`,
  );
  const body = lines.join('\n');
  return body.length <= maxChars ? body : body.slice(0, maxChars) + '\n...[upstream registry truncated]';
}
