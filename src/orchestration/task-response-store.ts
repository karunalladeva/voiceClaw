import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ensureTaskArtifactDir,
  getTaskArtifactRelDir,
  writeTaskArtifactManifest,
  type TaskArtifactScope,
} from './task-artifacts';

export type TaskResponderType = 'skill' | 'agent' | 'tool';

export interface SaveTaskResponseParams {
  task: TaskArtifactScope;
  responderId: string;
  responderType: TaskResponderType;
  content: string;
  agentId?: string;
  success?: boolean;
}

function sanitizeResponderId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return cleaned.slice(0, 120) || 'unknown';
}

function formatResponseBody(params: SaveTaskResponseParams): string {
  const lines = [
    `# ${params.responderType}: ${params.responderId}`,
    '',
    `- taskId: ${params.task.id}`,
    `- savedAt: ${new Date().toISOString()}`,
  ];
  if (params.agentId) lines.push(`- agentId: ${params.agentId}`);
  if (params.success === false) lines.push('- success: false');
  lines.push('', params.content.trim(), '');
  return lines.join('\n');
}

/** Persist a skill, tool, or agent response under artifacts/{root}/{taskId}/{responderId}/ */
export async function saveTaskResponse(params: SaveTaskResponseParams): Promise<string | null> {
  const trimmed = params.content?.trim();
  if (!trimmed) return null;
  const responderId = sanitizeResponderId(params.responderId);
  await ensureTaskArtifactDir(params.task);
  const taskRelDir = getTaskArtifactRelDir(params.task);
  const responderRelDir = `${taskRelDir}/${responderId}`.replace(/\\/g, '/');
  const responderAbsDir = path.join(process.cwd(), ...responderRelDir.split('/'));
  await fs.mkdir(responderAbsDir, { recursive: true });
  const body = formatResponseBody(params);
  await fs.writeFile(path.join(responderAbsDir, 'latest.md'), body, 'utf-8');
  const stampedRel = `${responderRelDir}/${Date.now()}.md`.replace(/\\/g, '/');
  const stampedAbs = path.join(process.cwd(), ...stampedRel.split('/'));
  await fs.writeFile(stampedAbs, body, 'utf-8');
  await writeTaskArtifactManifest(params.task);
  return stampedRel;
}

export function persistTaskResponse(params: SaveTaskResponseParams): void {
  void saveTaskResponse(params).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Orchestration] Failed to save ${params.responderType} response (${params.responderId}): ${msg}`);
  });
}
