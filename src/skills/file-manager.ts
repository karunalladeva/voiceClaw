import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { BaseSkill, SkillDefinition } from './base-skill';
import * as fs from 'fs/promises';
import * as path from 'path';

const WORKSPACE = path.join(process.cwd(), 'workspace');

const readFileTool = tool(
  async ({ filename }) => {
    try {
      const safePath = path.resolve(WORKSPACE, path.basename(filename));
      if (!safePath.startsWith(WORKSPACE)) return 'Access denied.';
      return await fs.readFile(safePath, 'utf-8');
    } catch (e: any) {
      return `Error reading file: ${e.message}`;
    }
  },
  {
    name: 'read_file',
    description: 'Read a file from the workspace directory.',
    schema: z.object({ filename: z.string().describe('Name of the file to read') }),
  }
);

const writeFileTool = tool(
  async ({ filename, content }) => {
    try {
      const safePath = path.resolve(WORKSPACE, path.basename(filename));
      if (!safePath.startsWith(WORKSPACE)) return 'Access denied.';
      await fs.writeFile(safePath, content, 'utf-8');
      return `Successfully wrote to ${filename}`;
    } catch (e: any) {
      return `Error writing file: ${e.message}`;
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace directory.',
    schema: z.object({
      filename: z.string().describe('Name of the file to write'),
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
        'When asked to save something, use the write_file tool. When asked to recall or find something, use read_file or list_files. ' +
        'Keep responses brief as they will be spoken aloud.',
      tools: [readFileTool, writeFileTool, listFilesTool],
      enabled: true,
    };
  }
}
