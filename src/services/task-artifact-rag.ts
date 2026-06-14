import * as fs from 'fs/promises';
import * as path from 'path';
import { buildArtifactRagExcerpt } from './context-map-reduce';
import { listTaskArtifactRelPaths } from '../orchestration/task-artifacts';
import { getRootArtifactAbsDir } from '../orchestration/task-artifacts';

const MAX_FILE_READ = 8000;

async function readArtifactSnippet(absPath: string): Promise<string> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile() || stat.size > 512_000) return '';
    const buf = await fs.readFile(absPath, 'utf-8');
    return buf.slice(0, MAX_FILE_READ);
  } catch {
    return '';
  }
}

export async function buildTaskScopedArtifactRag(
  rootTaskId: string,
  query: string,
  maxChars: number,
): Promise<string> {
  const rootAbs = getRootArtifactAbsDir(rootTaskId);
  const entries: Array<{ relPath: string; content: string }> = [];
  try {
    const taskDirs = await fs.readdir(rootAbs);
    for (const taskId of taskDirs) {
      const scope = { id: taskId, rootTaskId };
      const paths = await listTaskArtifactRelPaths(scope);
      for (const rel of paths) {
        if (!/\.md$/i.test(rel) || rel.includes('/read_file/')) continue;
        const abs = path.join(process.cwd(), rel.replace(/\//g, path.sep));
        const content = await readArtifactSnippet(abs);
        if (content) entries.push({ relPath: rel, content });
      }
    }
  } catch {
    return '';
  }

  return buildArtifactRagExcerpt(entries, query, maxChars);
}
