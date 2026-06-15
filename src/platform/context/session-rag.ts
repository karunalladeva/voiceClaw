import * as fs from 'fs/promises';
import * as path from 'path';
import { bm25RankIndices } from '../../utils/bm25';
import { sessionContextService } from './session-context-service';
import { scopeStoreDir } from '../session/scope-id';

interface ChunkRow {
  pointerId: string;
  text: string;
  title: string;
}

function chunkText(text: string, chunkSize = 1200, overlap = 150): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks.filter((c) => c.trim().length > 40);
}

export class SessionRagIndex {
  private indexes = new Map<string, ChunkRow[]>();

  private key(scopeId: string): string {
    return scopeStoreDir(scopeId);
  }

  async indexPointer(scopeId: string, pointerId: string, body: string, title: string): Promise<void> {
    const chunks = chunkText(body);
    const rows = chunks.map((text) => ({ pointerId, text, title }));
    const k = this.key(scopeId);
    const existing = this.indexes.get(k) ?? [];
    this.indexes.set(k, [...existing.filter((r) => r.pointerId !== pointerId), ...rows]);
    const root = path.join(process.cwd(), 'workspace', 'session-store', scopeStoreDir(scopeId), 'rag-index.json');
    await fs.mkdir(path.dirname(root), { recursive: true });
    await fs.writeFile(root, JSON.stringify(this.indexes.get(k), null, 2), 'utf-8').catch(() => {});
  }

  async loadScope(scopeId: string): Promise<void> {
    const k = this.key(scopeId);
    if (this.indexes.has(k)) return;
    try {
      const root = path.join(process.cwd(), 'workspace', 'session-store', scopeStoreDir(scopeId), 'rag-index.json');
      const raw = await fs.readFile(root, 'utf-8');
      this.indexes.set(k, JSON.parse(raw) as ChunkRow[]);
    } catch {
      this.indexes.set(k, []);
    }
  }

  async search(scopeId: string, query: string, k = 5): Promise<Array<{ pointerId: string; excerpt: string; title: string; score: number }>> {
    await this.loadScope(scopeId);
    const rows = this.indexes.get(this.key(scopeId)) ?? [];
    if (rows.length === 0 || !query.trim()) return [];
    const rankedIdx = bm25RankIndices(
      rows.map((r) => `${r.title}\n${r.text}`),
      query,
    ).slice(0, k);
    return rankedIdx.map((idx, rank) => {
      const row = rows[idx];
      return {
        pointerId: row.pointerId,
        excerpt: row.text.slice(0, 800),
        title: row.title,
        score: k - rank,
      };
    });
  }

  async indexFromPointer(scopeId: string, pointerId: string): Promise<void> {
    const body = await sessionContextService.resolvePointer(scopeId, pointerId, { maxBytes: 200_000 });
    const title = pointerId;
    await this.indexPointer(scopeId, pointerId, body, title);
  }
}

export const sessionRagIndex = new SessionRagIndex();
