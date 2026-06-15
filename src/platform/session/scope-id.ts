/** Build canonical scope IDs for session-store paths. */
export function buildChatScopeId(chatId: string): string {
  return `chat:${chatId}`;
}

export function buildOrgScopeId(rootTaskId: string, taskId: string): string {
  return `org:${rootTaskId}:${taskId}`;
}

export function sanitizeScopeSegment(scopeId: string): string {
  return scopeId.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

/** Filesystem-safe directory name for a scope (Windows cannot use `:` in folder names). */
export function scopeStoreDir(scopeId: string): string {
  return sanitizeScopeSegment(scopeId).replace(/:/g, '_');
}
