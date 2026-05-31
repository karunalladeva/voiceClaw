import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { BaseSkill, SkillDefinition } from './base-skill';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getAgentRunContext, toTaskArtifactScope } from '../agents/agent-run-context';
import {
  ensureTaskArtifactDir,
  getTaskArtifactRelDir,
  resolveTaskArtifactFile,
} from '../orchestration/task-artifacts';

const WORKSPACE = path.join(process.cwd(), 'workspace');
const OUTPUTS_DIR = path.join(WORKSPACE, 'outputs', 'documents');

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
  const ctx = getAgentRunContext();
  if (ctx?.orgTaskId && !filename.includes('/') && !filename.includes('\\')) {
    const scope = toTaskArtifactScope(ctx);
    return resolveTaskArtifactFile(scope, filename).absPath;
  }
  if (filename.replace(/\\/g, '/').startsWith('workspace/')) {
    const abs = path.resolve(process.cwd(), filename);
    if (abs.startsWith(WORKSPACE)) return abs;
  }
  const outputsPath = path.resolve(OUTPUTS_DIR, path.basename(filename));
  if (outputsPath.startsWith(OUTPUTS_DIR)) return outputsPath;
  const workspacePath = path.resolve(WORKSPACE, path.basename(filename));
  if (!workspacePath.startsWith(WORKSPACE)) throw new Error('Access denied.');
  return workspacePath;
}

const readFileTool = tool(
  async ({ filename }) => {
    try {
      let safePath = resolveReadTarget(filename);
      try {
        await fs.access(safePath);
      } catch {
        safePath = path.resolve(OUTPUTS_DIR, path.basename(filename));
        if (!safePath.startsWith(OUTPUTS_DIR)) {
          safePath = path.resolve(WORKSPACE, path.basename(filename));
          if (!safePath.startsWith(WORKSPACE)) return 'Access denied.';
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
      'Read a file from the workspace. During org tasks, reads from the current task artifact folder first.',
    schema: z.object({ filename: z.string().describe('Name of the file to read') }),
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
      await fs.mkdir(WORKSPACE, { recursive: true });
      const files = await fs.readdir(WORKSPACE);
      return files.length > 0 ? files.join('\n') : 'Workspace is empty.';
    } catch (e: any) {
      return `Error listing files: ${e.message}`;
    }
  },
  {
    name: 'list_files',
    description: 'List all files in the workspace directory.',
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
        'When asked to save something, use the write_file tool. When asked to recall or find something, use read_file or list_files. ' +
        'Keep responses brief as they will be spoken aloud.',
      tools: [readFileTool, writeFileTool, listFilesTool],
      enabled: true,
    };
  }
}
