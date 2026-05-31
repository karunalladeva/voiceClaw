import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ensureTaskArtifactDir,
  getTaskArtifactRelDir,
  listTaskArtifactRelPaths,
  writeTaskArtifactManifest,
} from './task-artifacts';

const MIN_CONTENT_LENGTH = 2000;
const CHAPTER_HEADER = /^##\s+CHAPTER\s+\d+/im;

export interface MaterializeResult {
  writtenPaths: string[];
  skipped: boolean;
  reason?: string;
}

export async function materializeWorkProductChapters(
  taskId: string,
  rootTaskId: string,
  content: string,
  title?: string,
): Promise<MaterializeResult> {
  const trimmed = content?.trim() ?? '';
  if (trimmed.length < MIN_CONTENT_LENGTH) {
    return { writtenPaths: [], skipped: true, reason: 'content below threshold' };
  }
  const scope = { id: taskId, rootTaskId };
  const absDir = await ensureTaskArtifactDir(scope);
  const relDir = getTaskArtifactRelDir(scope);
  const existing = await fs.readdir(absDir).catch(() => [] as string[]);
  if (existing.some((name) => /^chapter-\d+\.md$/i.test(name))) {
    return { writtenPaths: [], skipped: true, reason: 'chapter files already exist' };
  }
  if (!CHAPTER_HEADER.test(trimmed)) {
    return { writtenPaths: [], skipped: true, reason: 'no chapter headers found' };
  }
  const parts = trimmed.split(/(?=^##\s+CHAPTER\s+\d+)/im).filter((p) => p.trim());
  if (parts.length < 2) {
    return { writtenPaths: [], skipped: true, reason: 'insufficient chapter sections' };
  }
  const writtenPaths: string[] = [];
  let chapterIndex = 0;
  for (const part of parts) {
    const headerMatch = part.match(/^##\s+CHAPTER\s+(\d+)/im);
    if (!headerMatch) continue;
    chapterIndex += 1;
    const fileName = `chapter-${String(chapterIndex).padStart(2, '0')}.md`;
    const absPath = path.join(absDir, fileName);
    if (await fileExists(absPath)) continue;
    await fs.writeFile(absPath, part.trim(), 'utf-8');
    writtenPaths.push(`${relDir}/${fileName}`);
  }
  if (writtenPaths.length === 0) {
    return { writtenPaths: [], skipped: true, reason: 'no new chapter files written' };
  }
  const assetPaths = await listTaskArtifactRelPaths(scope);
  await writeTaskArtifactManifest(scope, { title, assetPaths });
  return { writtenPaths, skipped: false };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
