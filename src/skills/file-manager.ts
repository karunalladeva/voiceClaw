import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { BaseSkill, SkillDefinition } from './base-skill';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getAgentRunContext, toTaskArtifactScope } from '../agents/agent-run-context';
import {
  ensureTaskArtifactDir,
  getTaskArtifactAbsDir,
  getTaskArtifactRelDir,
  listTaskArtifactRelPaths,
  resolveTaskArtifactFile,
} from '../orchestration/task-artifacts';

const WORKSPACE = path.join(process.cwd(), 'workspace');
const OUTPUTS_DIR = path.join(WORKSPACE, 'outputs', 'documents');
/** Avoid loading huge files into the skill LLM context. */
const MAX_READ_BYTES = 512_000;
/** Tool-response audit folders (not user deliverables). */
const TOOL_TRACE_DIRS = new Set(['read_file', 'list_files', 'write_file']);

function filterDeliverablePaths(paths: string[], taskRelDir: string): string[] {
  const prefix = `${taskRelDir}/`;
  return paths.filter((p) => {
    if (!p.startsWith(prefix)) return true;
    const rest = p.slice(prefix.length);
    const top = rest.split('/')[0];
    return !TOOL_TRACE_DIRS.has(top);
  });
}

function resolveWriteTarget(filename: string): { absPath: string; relPath: string } {
  const ctx = getAgentRunContext();
  if (ctx?.orgTaskId) {
    const scope = toTaskArtifactScope(ctx);
    const { absPath, relPath } = resolveTaskArtifactFile(scope, filename);
    return { absPath, relPath };
  }
  const safePath = path.resolve(OUTPUTS_DIR, path.basename(filename));
  if (!safePath.startsWith(OUTPUTS_DIR)) {
    throw new Error('Access denied.');
  }
  return {
    absPath: safePath,
    relPath: `workspace/outputs/documents/${path.basename(filename)}`,
  };
}

function resolveReadTarget(filename: string): string {
  const norm = filename.replace(/\\/g, '/').trim();
  const ctx = getAgentRunContext();
  if (ctx?.orgTaskId) {
    const scope = toTaskArtifactScope(ctx);
    const taskRelDir = getTaskArtifactRelDir(scope);
    const taskAbsDir = getTaskArtifactAbsDir(scope);
    if (norm.startsWith('workspace/')) {
      const abs = path.resolve(process.cwd(), norm);
      if (abs.startsWith(WORKSPACE + path.sep) || abs === WORKSPACE) return abs;
    }
    if (norm.startsWith(taskRelDir + '/')) {
      const abs = path.resolve(process.cwd(), norm);
      if (abs.startsWith(taskAbsDir + path.sep) || abs === taskAbsDir) return abs;
    }
    const underTask = norm.includes('/') || norm.includes('\\')
      ? path.join(taskAbsDir, ...norm.split(/[/\\]/).filter(Boolean))
      : resolveTaskArtifactFile(scope, norm).absPath;
    if (underTask.startsWith(taskAbsDir + path.sep) || underTask === taskAbsDir) {
      return underTask;
    }
  }
  if (norm.startsWith('workspace/')) {
    const abs = path.resolve(process.cwd(), norm);
    if (abs.startsWith(WORKSPACE + path.sep) || abs === WORKSPACE) return abs;
  }
  const outputsPath = path.resolve(OUTPUTS_DIR, path.basename(norm));
  if (outputsPath.startsWith(OUTPUTS_DIR + path.sep)) return outputsPath;
  const workspacePath = path.resolve(WORKSPACE, path.basename(norm));
  if (!workspacePath.startsWith(WORKSPACE + path.sep)) throw new Error('Access denied.');
  return workspacePath;
}

const readFileTool = tool(
  async ({ filename }) => {
    try {
      const safePath = resolveReadTarget(filename);
      const stat = await fs.stat(safePath);
      if (stat.isDirectory()) {
        return `Error: "${filename}" is a directory. Use list_files to see files in this folder.`;
      }
      if (stat.size > MAX_READ_BYTES) {
        const handle = await fs.open(safePath, 'r');
        try {
          const buf = Buffer.alloc(MAX_READ_BYTES);
          await handle.read(buf, 0, MAX_READ_BYTES, 0);
          return (
            buf.toString('utf-8') +
            `\n\n[TRUNCATED] File is ${stat.size} bytes; showing first ${MAX_READ_BYTES} bytes.`
          );
        } finally {
          await handle.close();
        }
      }
      return await fs.readFile(safePath, 'utf-8');
    } catch (e: any) {
      return `Error reading file: ${e.message}`;
    }
  },
  {
    name: 'read_file',
    description:
      'Read a file from the workspace. During org tasks, paths resolve under the task artifact folder ' +
      '(basename, subpath like chapter-01.md, or full workspace/orchestration/artifacts/... path).',
    schema: z.object({
      filename: z.string().describe('File name, subpath under task artifacts, or workspace/... path'),
    }),
  }
);

const writeFileTool = tool(
  async ({ filename, content }) => {
    try {
      const ctx = getAgentRunContext();
      if (ctx?.orgTaskId) {
        await ensureTaskArtifactDir(toTaskArtifactScope(ctx));
      } else {
        await fs.mkdir(OUTPUTS_DIR, { recursive: true });
      }
      const { absPath, relPath } = resolveWriteTarget(filename);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, 'utf-8');
      const savedName = path.basename(filename);
      if (savedName.toLowerCase().endsWith('.pdf')) {
        return `Saved PDF: [${savedName}](/workspace/download/${relPath.replace(/^workspace\//, '')})`;
      }
      return `Saved to ${relPath}`;
    } catch (e: any) {
      return `Error writing file: ${e.message}`;
    }
  },
  {
    name: 'write_file',
    description:
      'Write content to disk. During org tasks, saves under workspace/orchestration/artifacts/{rootTaskId}/{taskId}/. Otherwise workspace/outputs/documents/.',
    schema: z.object({
      filename: z.string().describe('Name of file to write (e.g. chapter-01.md, report.pdf)'),
      content: z.string().describe('Content to write'),
    }),
  }
);

const listFilesTool = tool(
  async () => {
    try {
      const ctx = getAgentRunContext();
      if (ctx?.orgTaskId) {
        const scope = toTaskArtifactScope(ctx);
        const taskRelDir = getTaskArtifactRelDir(scope);
        const paths = filterDeliverablePaths(await listTaskArtifactRelPaths(scope), taskRelDir);
        if (paths.length === 0) {
          return (
            `Task artifact folder is empty (no deliverables yet).\n` +
            `Folder: ${taskRelDir}/\n` +
            `Use write_file to save outputs here.`
          );
        }
        return `Task artifact files (${taskRelDir}/):\n${paths.join('\n')}`;
      }
      await fs.mkdir(WORKSPACE, { recursive: true });
      const files = await fs.readdir(WORKSPACE);
      return files.length > 0 ? files.join('\n') : 'Workspace is empty.';
    } catch (e: any) {
      return `Error listing files: ${e.message}`;
    }
  },
  {
    name: 'list_files',
    description:
      'List files. During org tasks, lists deliverables in the current task artifact folder; otherwise workspace root.',
    schema: z.object({}),
  }
);

export default class FileManagerSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: 'file-manager',
      name: 'File Manager',
      description: 'Reads, writes, and lists files in the workspace.',
      triggerDescription: 'Use when the user asks to read, write, create, list, or manage files and notes.',
      systemPrompt:
        'You are a file management assistant. You can read, write, and list files in the user\'s workspace. ' +
        'When running an orchestration task, always write deliverables into the task artifact folder shown in your task context (workspace/orchestration/artifacts/{rootTaskId}/{taskId}/). ' +
        'When asked to save something, use write_file. When asked what is in the task folder, use list_files (not the workspace root). ' +
        'read_file accepts a basename, a subpath under the task artifact folder, or a full workspace/... path. ' +
        'Keep responses brief as they will be spoken aloud.',
      tools: [readFileTool, writeFileTool, listFilesTool],
      enabled: true,
    };
  }
}
