import * as fs from 'fs/promises';
import * as path from 'path';

const ARTIFACTS_ROOT = path.join(process.cwd(), 'workspace', 'orchestration', 'artifacts');

export interface TaskArtifactScope {
  id: string;
  rootTaskId?: string;
}

export interface TaskArtifactManifest {
  taskId: string;
  rootTaskId: string;
  title?: string;
  updatedAt: number;
  assetPaths: string[];
}

/** Relative path from repo root, POSIX slashes. */
export function getTaskArtifactRelDir(task: TaskArtifactScope): string {
  const rootId = task.rootTaskId ?? task.id;
  return `workspace/orchestration/artifacts/${rootId}/${task.id}`;
}

export function getTaskArtifactAbsDir(task: TaskArtifactScope): string {
  return path.join(process.cwd(), getTaskArtifactRelDir(task));
}

export function getRootArtifactRelDir(rootTaskId: string): string {
  return `workspace/orchestration/artifacts/${rootTaskId}`;
}

export function getRootArtifactAbsDir(rootTaskId: string): string {
  return path.join(process.cwd(), getRootArtifactRelDir(rootTaskId));
}

export async function ensureTaskArtifactDir(task: TaskArtifactScope): Promise<string> {
  const absDir = getTaskArtifactAbsDir(task);
  await fs.mkdir(absDir, { recursive: true });
  return absDir;
}

export function resolveTaskArtifactFile(task: TaskArtifactScope, filename: string): {
  absPath: string;
  relPath: string;
} {
  const safeName = path.basename(filename);
  const relPath = `${getTaskArtifactRelDir(task)}/${safeName}`;
  const absPath = path.join(process.cwd(), relPath);
  const absDir = path.dirname(absPath);
  if (!path.resolve(absPath).startsWith(path.resolve(absDir) + path.sep)) {
    throw new Error('Invalid artifact filename');
  }
  return { absPath, relPath: relPath.replace(/\\/g, '/') };
}

const SKIP_NAMES = new Set(['output.md', 'manifest.json']);

export async function listTaskArtifactRelPaths(task: TaskArtifactScope): Promise<string[]> {
  const absDir = getTaskArtifactAbsDir(task);
  const relDir = getTaskArtifactRelDir(task);
  const paths: string[] = [];
  const walk = async (dir: string, relPrefix: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = `${relPrefix}/${entry.name}`.replace(/\\/g, '/');
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
        continue;
      }
      if (SKIP_NAMES.has(entry.name) && relPrefix === relDir) continue;
      paths.push(rel);
    }
  };
  await walk(absDir, relDir);
  return paths.sort();
}

export async function writeTaskArtifactManifest(
  task: TaskArtifactScope,
  extra?: Partial<TaskArtifactManifest>,
): Promise<TaskArtifactManifest> {
  const absDir = await ensureTaskArtifactDir(task);
  const assetPaths = await listTaskArtifactRelPaths(task);
  const manifest: TaskArtifactManifest = {
    taskId: task.id,
    rootTaskId: task.rootTaskId ?? task.id,
    updatedAt: Date.now(),
    assetPaths,
    ...extra,
  };
  await fs.writeFile(
    path.join(absDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );
  return manifest;
}

export async function listSiblingTaskArtifactDirs(rootTaskId: string): Promise<string[]> {
  const rootAbs = getRootArtifactAbsDir(rootTaskId);
  try {
    const entries = await fs.readdir(rootAbs, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => `${getRootArtifactRelDir(rootTaskId)}/${e.name}`.replace(/\\/g, '/'))
      .sort();
  } catch {
    return [];
  }
}

export async function copyFileIntoTaskArtifacts(
  task: TaskArtifactScope,
  sourceAbsPath: string,
  destSubpath: string,
): Promise<string> {
  const safeSub = destSubpath.replace(/\\/g, '/').split('/').filter(Boolean).join('/');
  const fileName = path.basename(safeSub);
  const subDir = path.dirname(safeSub);
  const absDir = await ensureTaskArtifactDir(task);
  const destDir = subDir === '.' ? absDir : path.join(absDir, subDir);
  await fs.mkdir(destDir, { recursive: true });
  const destAbs = path.join(destDir, fileName);
  await fs.copyFile(sourceAbsPath, destAbs);
  const relPath = `${getTaskArtifactRelDir(task)}/${safeSub}`.replace(/\\/g, '/');
  return relPath;
}
