export type PhaseSpanName =
  | 'stt'
  | 'router'
  | 'tools'
  | 'extract'
  | 'write'
  | 'tts'
  | 'governor'
  | 'rag';

export interface PhaseSpanPayload {
  phase: PhaseSpanName;
  ms?: number;
  detail?: string;
}

export interface PointerEventPayload {
  action: 'register' | 'swap' | 'read';
  pointerId: string;
  scopeId: string;
}

export interface CitationRecord {
  claim: string;
  source: string;
  url?: string;
  pointerId?: string;
  fetchedAt?: string;
}

export interface CitationsEventPayload {
  citations: CitationRecord[];
}
