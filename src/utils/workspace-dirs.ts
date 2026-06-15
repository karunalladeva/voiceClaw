import * as fs from 'fs/promises';
import * as path from 'path';

export const WORKSPACE_ROOT = path.join(process.cwd(), 'workspace');
export const OUTPUTS_DOCUMENTS_DIR = path.join(WORKSPACE_ROOT, 'outputs', 'documents');
export const OUTPUTS_SCREENSHOTS_DIR = path.join(WORKSPACE_ROOT, 'outputs', 'screenshots');
export const OUTPUTS_TMP_DIR = path.join(WORKSPACE_ROOT, 'outputs', '.tmp');
export const ORCHESTRATION_ARTIFACTS_DIR = path.join(WORKSPACE_ROOT, 'orchestration', 'artifacts');

/** Standard workspace output folders used by file tools, PDF, screenshots, etc. */
export async function ensureWorkspaceDirs(): Promise<void> {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  await fs.mkdir(OUTPUTS_DOCUMENTS_DIR, { recursive: true });
  await fs.mkdir(OUTPUTS_SCREENSHOTS_DIR, { recursive: true });
  await fs.mkdir(OUTPUTS_TMP_DIR, { recursive: true });
  await fs.mkdir(ORCHESTRATION_ARTIFACTS_DIR, { recursive: true });
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}
