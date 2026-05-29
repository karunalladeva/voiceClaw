function normalizeScope(scope: string | undefined): string {
  const raw = String(scope || 'pipeline').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'pipeline';
}

function formatDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

export function resolveExecutionChatId(pipelineId?: string): string {
  // Use the pipeline's own ID directly, or fallback to generic
  return pipelineId || 'execution-pipeline';
}

export function resolveExecutionChatTitle(pipelineName?: string): string {
  // Use pipeline name + date for human-readable title
  const name = pipelineName || 'Pipeline Execution';
  return `${name} - ${formatDate()}`;
}

