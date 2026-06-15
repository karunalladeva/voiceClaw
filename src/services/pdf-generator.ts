import * as fs from 'fs/promises';
import * as path from 'path';
import { chromium } from 'playwright';
import { ensureParentDir } from '../utils/workspace-dirs';

export type PdfPageFormat = 'A4' | 'Letter';

export interface PdfStyleOptions {
  title?: string;
  subtitle?: string;
  pageFormat?: PdfPageFormat;
  marginMm?: number;
  fontFamily?: string;
  fontSizePt?: number;
  pageBreakBeforeH2?: boolean;
}

export interface PdfGenerateResult {
  absPath: string;
  relPath: string;
  bytes: number;
  pageCountEstimate?: number;
}

const WORKSPACE = path.join(process.cwd(), 'workspace');

const DEFAULT_STYLE: Required<Omit<PdfStyleOptions, 'title' | 'subtitle'>> = {
  pageFormat: 'A4',
  marginMm: 18,
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSizePt: 12,
  pageBreakBeforeH2: true,
};

export function stripArtifactMeta(raw: string): string {
  let text = raw;
  text = text.replace(/^# agent:[^\n]*\n/m, '');
  text = text.replace(/^- taskId:[^\n]*\n/gm, '');
  text = text.replace(/^- savedAt:[^\n]*\n/gm, '');
  text = text.replace(/^- agentId:[^\n]*\n/gm, '');
  text = text.replace(/<spoken_summary>[\s\S]*?<\/spoken_summary>/gi, '');
  text = text.replace(/```json[\s\S]*?```/g, '');
  return text.trim();
}

export function markdownToHtmlBody(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const lines = escaped.split('\n');
  const html: string[] = [];
  let inList = false;
  let listTag: 'ul' | 'ol' | null = null;
  const closeList = (): void => {
    if (inList && listTag) {
      html.push(`</${listTag}>`);
      inList = false;
      listTag = null;
    }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      html.push('<p></p>');
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed)) {
      closeList();
      const level = trimmed.match(/^#+/)?.[0].length ?? 2;
      const tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
      html.push(`<${tag}>${trimmed.replace(/^#+\s*/, '')}</${tag}>`);
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      if (!inList || listTag !== 'ol') {
        closeList();
        html.push('<ol>');
        inList = true;
        listTag = 'ol';
      }
      html.push(`<li>${trimmed.replace(/^\d+\.\s*/, '')}</li>`);
      continue;
    }
    if (/^[-*]\s/.test(trimmed)) {
      if (!inList || listTag !== 'ul') {
        closeList();
        html.push('<ul>');
        inList = true;
        listTag = 'ul';
      }
      html.push(`<li>${trimmed.replace(/^[-*]\s*/, '')}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${trimmed}</p>`);
  }
  closeList();
  return html.join('\n');
}

function buildHtmlDocument(bodyHtml: string, style: PdfStyleOptions): string {
  const merged = { ...DEFAULT_STYLE, ...style };
  const h2Break = merged.pageBreakBeforeH2 ? 'h2 { page-break-before: always; } h2:first-of-type { page-break-before: avoid; }' : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body { font-family: ${merged.fontFamily}; max-width: 720px; margin: 40px auto; line-height: 1.55; color: #111; }
  h1 { font-size: 28px; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 8px; }
  .subtitle { font-size: 14px; color: #555; margin-bottom: 24px; }
  h2 { font-size: 20px; margin-top: 32px; color: #222; ${merged.pageBreakBeforeH2 ? '' : ''} }
  h3 { font-size: 16px; }
  p, li { font-size: ${merged.fontSizePt}pt; }
  ul, ol { padding-left: 24px; }
  hr { border: none; border-top: 1px solid #ccc; margin: 24px 0; }
  em { color: #555; }
  img { max-width: 100%; height: auto; }
  ${h2Break}
</style></head><body>
${style.title ? `<h1>${style.title.replace(/</g, '&lt;')}</h1>` : ''}
${style.subtitle ? `<p class="subtitle">${style.subtitle.replace(/</g, '&lt;')}</p>` : ''}
${bodyHtml}
</body></html>`;
}

export function resolveWorkspacePath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/').trim();
  if (path.isAbsolute(inputPath)) {
    const abs = path.resolve(inputPath);
    if (!abs.startsWith(WORKSPACE) && !abs.startsWith(process.cwd())) {
      throw new Error('Path must be under workspace/ or project root.');
    }
    return abs;
  }
  if (normalized.startsWith('workspace/')) {
    return path.resolve(process.cwd(), normalized);
  }
  return path.resolve(WORKSPACE, normalized);
}

export async function readMarkdownFile(absPath: string, cleanMeta: boolean): Promise<string> {
  const raw = await fs.readFile(absPath, 'utf-8');
  return cleanMeta ? stripArtifactMeta(raw) : raw.trim();
}

export async function collectMarkdownFiles(
  dirAbsPath: string,
  options?: { recursive?: boolean; pattern?: RegExp },
): Promise<string[]> {
  const recursive = options?.recursive ?? true;
  const pattern = options?.pattern ?? /\.md$/i;
  const skip = new Set(['output.md', 'manifest.json', 'latest.md']);
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await walk(abs);
        continue;
      }
      if (!pattern.test(entry.name) || skip.has(entry.name)) continue;
      files.push(abs);
    }
  };
  await walk(dirAbsPath);
  return files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function mergeMarkdownFiles(
  filePaths: string[],
  options?: { title?: string; subtitle?: string; sectionSeparator?: string; cleanMeta?: boolean },
): Promise<string> {
  const cleanMeta = options?.cleanMeta ?? true;
  const separator = options?.sectionSeparator ?? '\n\n---\n\n';
  const parts: string[] = [];
  if (options?.title) {
    parts.push(`# ${options.title}`, '');
    if (options.subtitle) parts.push(`_${options.subtitle}_`, '');
  }
  for (const filePath of filePaths) {
    const content = await readMarkdownFile(filePath, cleanMeta);
    if (!content) continue;
    parts.push(content);
  }
  return parts.join(separator).trim();
}

export async function generatePdfFromMarkdown(
  markdown: string,
  outputAbsPath: string,
  style: PdfStyleOptions = {},
): Promise<PdfGenerateResult> {
  await fs.mkdir(path.dirname(outputAbsPath), { recursive: true });
  const bodyHtml = markdownToHtmlBody(markdown);
  const html = buildHtmlDocument(bodyHtml, style);
  const margin = `${style.marginMm ?? DEFAULT_STYLE.marginMm}mm`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: outputAbsPath,
      format: style.pageFormat ?? DEFAULT_STYLE.pageFormat,
      margin: { top: margin, bottom: margin, left: margin, right: margin },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
  const stat = await fs.stat(outputAbsPath);
  const relPath = path.relative(process.cwd(), outputAbsPath).replace(/\\/g, '/');
  return { absPath: outputAbsPath, relPath, bytes: stat.size };
}

export async function generatePdfFromFiles(
  inputPaths: string[],
  outputAbsPath: string,
  style: PdfStyleOptions = {},
): Promise<PdfGenerateResult & { sourceFiles: string[] }> {
  const absInputs = inputPaths.map((p) => resolveWorkspacePath(p));
  const markdown = await mergeMarkdownFiles(absInputs, {
    title: style.title,
    subtitle: style.subtitle,
    cleanMeta: true,
  });
  const mdSidecar = outputAbsPath.replace(/\.pdf$/i, '.md');
  await ensureParentDir(mdSidecar);
  await fs.writeFile(mdSidecar, markdown, 'utf-8');
  const result = await generatePdfFromMarkdown(markdown, outputAbsPath, style);
  return { ...result, sourceFiles: absInputs };
}

export async function generatePdfFromDirectory(
  dirPath: string,
  outputFilename: string,
  style: PdfStyleOptions = {},
): Promise<PdfGenerateResult & { sourceFiles: string[] }> {
  const dirAbs = resolveWorkspacePath(dirPath);
  const files = await collectMarkdownFiles(dirAbs, { pattern: /^(chapter-|toc|section-|part-).*\.md$/i });
  const allMd =
    files.length > 0 ? files : await collectMarkdownFiles(dirAbs, { pattern: /\.md$/i });
  if (allMd.length === 0) {
    throw new Error(`No markdown files found under ${dirPath}`);
  }
  const outputAbsPath = path.join(dirAbs, path.basename(outputFilename));
  return generatePdfFromFiles(
    allMd.map((f) => path.relative(process.cwd(), f).replace(/\\/g, '/')),
    outputAbsPath,
    style,
  );
}

export const pdfGenerator = {
  stripArtifactMeta,
  markdownToHtmlBody,
  mergeMarkdownFiles,
  generatePdfFromMarkdown,
  generatePdfFromFiles,
  generatePdfFromDirectory,
  collectMarkdownFiles,
  resolveWorkspacePath,
};
