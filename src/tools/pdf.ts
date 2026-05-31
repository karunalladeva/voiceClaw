import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as path from 'path';
import { getAgentRunContext, toTaskArtifactScope } from '../agents/agent-run-context';
import {
  ensureTaskArtifactDir,
  getRootArtifactAbsDir,
  resolveTaskArtifactFile,
} from '../orchestration/task-artifacts';
import {
  generatePdfFromDirectory,
  generatePdfFromFiles,
  generatePdfFromMarkdown,
  pdfGenerator,
} from '../services/pdf-generator';

function resolveOutputPath(filename: string): { absPath: string; relPath: string } {
  const ctx = getAgentRunContext();
  const safeName = path.basename(filename);
  if (!safeName.toLowerCase().endsWith('.pdf')) {
    throw new Error('Output filename must end with .pdf');
  }
  if (ctx?.orgTaskId) {
    return resolveTaskArtifactFile(toTaskArtifactScope(ctx), safeName);
  }
  const relPath = `workspace/outputs/documents/${safeName}`;
  const absPath = path.join(process.cwd(), relPath);
  return { absPath, relPath: relPath.replace(/\\/g, '/') };
}

function formatPdfResult(result: { relPath: string; bytes: number; sourceFiles?: string[] }): string {
  const downloadPath = result.relPath.replace(/^workspace\//, '');
  const lines = [
    `PDF generated successfully (${result.bytes} bytes).`,
    `Path: ${result.relPath}`,
    `Download: /workspace/download/${downloadPath}`,
  ];
  if (result.sourceFiles?.length) {
    lines.push(`Sources (${result.sourceFiles.length}):`);
    for (const src of result.sourceFiles.slice(0, 20)) {
      lines.push(`- ${path.relative(process.cwd(), src).replace(/\\/g, '/')}`);
    }
    if (result.sourceFiles.length > 20) {
      lines.push(`- ... and ${result.sourceFiles.length - 20} more`);
    }
  }
  return lines.join('\n');
}

export const pdfGenerateTool = tool(
  async ({ markdown, title, subtitle, outputFilename, pageFormat, marginMm }) => {
    try {
      const { absPath, relPath } = resolveOutputPath(outputFilename);
      await ensureTaskArtifactDirIfNeeded();
      const result = await generatePdfFromMarkdown(markdown, absPath, {
        title,
        subtitle,
        pageFormat,
        marginMm,
      });
      return formatPdfResult({ ...result, relPath });
    } catch (err: unknown) {
      return `PDF generation failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'pdf_generate',
    description:
      'Generate a formatted PDF from markdown content. Saves to the current task artifact folder during org tasks, otherwise workspace/outputs/documents/.',
    schema: z.object({
      markdown: z.string().describe('Full markdown body (headings, lists, paragraphs). Title can be separate.'),
      title: z.string().optional().describe('Document title shown on cover'),
      subtitle: z.string().optional().describe('Optional subtitle under the title'),
      outputFilename: z.string().default('document.pdf').describe('Output PDF filename, e.g. digital-product.pdf'),
      pageFormat: z.enum(['A4', 'Letter']).optional().describe('Page size (default A4)'),
      marginMm: z.number().optional().describe('Page margin in mm (default 18)'),
    }),
  },
);

export const pdfMergeFilesTool = tool(
  async ({ inputFiles, title, subtitle, outputFilename, pageFormat, marginMm }) => {
    try {
      if (inputFiles.length === 0) {
        return 'inputFiles must include at least one markdown file path.';
      }
      const { absPath, relPath } = resolveOutputPath(outputFilename);
      await ensureTaskArtifactDirIfNeeded();
      const result = await generatePdfFromFiles(inputFiles, absPath, {
        title,
        subtitle,
        pageFormat,
        marginMm,
      });
      return formatPdfResult({ ...result, relPath });
    } catch (err: unknown) {
      return `PDF merge failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'pdf_merge_files',
    description:
      'Merge multiple markdown files (chapters, sections) into one formatted PDF. Paths relative to workspace/ or project root.',
    schema: z.object({
      inputFiles: z.array(z.string()).describe('Ordered list of markdown file paths to merge'),
      title: z.string().optional().describe('Document title'),
      subtitle: z.string().optional().describe('Optional subtitle'),
      outputFilename: z.string().default('document.pdf'),
      pageFormat: z.enum(['A4', 'Letter']).optional(),
      marginMm: z.number().optional(),
    }),
  },
);

export const pdfMergePipelineTool = tool(
  async ({ rootTaskId, subtaskIds, title, subtitle, outputFilename, pageFormat, marginMm }) => {
    try {
      const ctx = getAgentRunContext();
      const root = rootTaskId || ctx?.orgRootTaskId || ctx?.orgTaskId;
      if (!root) {
        return 'rootTaskId is required when not running inside an org task context.';
      }
      const rootDir = getRootArtifactAbsDir(root);
      const files: string[] = [];
      if (subtaskIds && subtaskIds.length > 0) {
        for (const subId of subtaskIds) {
          const subDir = path.join(rootDir, subId);
          const collected = await pdfGenerator.collectMarkdownFiles(subDir);
          if (collected.length > 0) {
            files.push(...collected);
            continue;
          }
          const outputMd = path.join(subDir, 'output.md');
          try {
            await import('fs/promises').then((fs) => fs.access(outputMd));
            files.push(outputMd);
          } catch {
            // skip empty subtask
          }
        }
      } else {
        const all = await pdfGenerator.collectMarkdownFiles(rootDir, { pattern: /\.md$/i });
        files.push(...all.filter((f) => !f.endsWith(`${path.sep}output.md`)));
      }
      const uniqueSorted = [...new Set(files)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (uniqueSorted.length === 0) {
        return `No markdown sources found under pipeline ${root}.`;
      }
      const { absPath, relPath } = resolveOutputPath(outputFilename);
      await ensureTaskArtifactDirIfNeeded();
      const result = await generatePdfFromFiles(
        uniqueSorted.map((f) => path.relative(process.cwd(), f).replace(/\\/g, '/')),
        absPath,
        { title, subtitle, pageFormat, marginMm },
      );
      return formatPdfResult({ ...result, relPath });
    } catch (err: unknown) {
      return `Pipeline PDF merge failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'pdf_merge_pipeline',
    description:
      'Merge markdown from orchestration pipeline subtask artifact folders into one PDF. Provide rootTaskId and optional ordered subtaskIds.',
    schema: z.object({
      rootTaskId: z.string().optional().describe('Pipeline root task id (defaults to current org root task)'),
      subtaskIds: z
        .array(z.string())
        .optional()
        .describe('Ordered subtask ids to include; omit to scan all subfolders'),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      outputFilename: z.string().default('digital-product.pdf'),
      pageFormat: z.enum(['A4', 'Letter']).optional(),
      marginMm: z.number().optional(),
    }),
  },
);

async function ensureTaskArtifactDirIfNeeded(): Promise<void> {
  const ctx = getAgentRunContext();
  if (ctx?.orgTaskId) {
    await ensureTaskArtifactDir(toTaskArtifactScope(ctx));
  }
}

export const pdfTools = [pdfGenerateTool, pdfMergeFilesTool, pdfMergePipelineTool];
