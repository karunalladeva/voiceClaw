export type HandoffPointerKind = 'tool' | 'skill' | 'artifact' | 'workflow';

export interface HandoffPointer {
  schemaVersion: 1;
  id: string;
  scopeId: string;
  kind: HandoffPointerKind;
  toolName?: string;
  skillId?: string;
  title: string;
  summary: string;
  byteSize: number;
  sha256: string;
  relPath: string;
  createdAt: string;
  expiresAt?: string;
  evidenceIds?: string[];
}

export interface RegisterPayloadMeta {
  kind: HandoffPointerKind;
  title: string;
  toolName?: string;
  skillId?: string;
  summary?: string;
}

export const HANDOFF_POINTER_MARKER = '[HandoffPointer]';

export function isHandoffPointerJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(t) as Partial<HandoffPointer>;
    return parsed.schemaVersion === 1 && typeof parsed.id === 'string' && typeof parsed.scopeId === 'string';
  } catch {
    return false;
  }
}

export function parseHandoffPointer(text: string): HandoffPointer | null {
  if (!isHandoffPointerJson(text)) return null;
  return JSON.parse(text.trim()) as HandoffPointer;
}

export function serializeHandoffPointer(pointer: HandoffPointer): string {
  return JSON.stringify(pointer);
}
