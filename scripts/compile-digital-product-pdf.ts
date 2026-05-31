import * as fs from 'fs/promises';
import * as path from 'path';
import { generatePdfFromMarkdown, stripArtifactMeta } from '../src/services/pdf-generator';

const ROOT = path.join(process.cwd(), 'workspace', 'orchestration', 'artifacts', '1780232293566-8ydoiv0');
const OUT_DIR = path.join(ROOT, '1780233062705-2wi9mfs');
const PDF_PATH = path.join(OUT_DIR, 'digital-product.pdf');
const MD_PATH = path.join(OUT_DIR, 'digital-product.md');

const SECTIONS: Array<{ title: string; taskId: string; prefer?: string }> = [
  { title: 'Table of Contents & Requirements', taskId: '1780233062661-p4cte5w', prefer: '1780079577522-bk2q761/latest.md' },
  { title: 'Chapter 01 – Introduction to 8-Hour Diet: Foundations', taskId: '1780233062668-nuiqhz6' },
  { title: 'Chapter 02 – Getting Started: Your First 30 Days', taskId: '1780233062678-36wnh6p' },
  { title: 'Chapter 03 – Common Mistakes to Avoid', taskId: '1780233062688-v0kc2fm', prefer: '1780079686331-qtvucsq/latest.md' },
  { title: 'Chapter 04 – Troubleshooting Plateaus', taskId: '1780233062690-hsrpuqa', prefer: '1780079686331-qtvucsq/latest.md' },
  { title: 'Chapter 05 – Hormone-Specific Protocols', taskId: '1780233062692-hohc7e7', prefer: '1780079686331-qtvucsq/latest.md' },
  { title: 'Chapter 06 – Calorie-Free Meal Planning', taskId: '1780233062693-vi38id8', prefer: '1780079686331-qtvucsq/latest.md' },
  { title: 'Chapter 07 – Recipe Integration', taskId: '1780233062695-88rtgyh', prefer: '1780079686331-qtvucsq/latest.md' },
  { title: 'Chapter 08 – Social Media & Long-Term Success', taskId: '1780233062698-ivcyk12', prefer: '1780079686331-qtvucsq/latest.md' },
];

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function pickSectionContent(taskId: string, prefer?: string): Promise<string> {
  const base = path.join(ROOT, taskId);
  if (prefer) {
    const preferred = await readIfExists(path.join(base, prefer));
    if (preferred && stripArtifactMeta(preferred).length > 80) {
      return stripArtifactMeta(preferred);
    }
  }
  const output = await readIfExists(path.join(base, 'output.md'));
  if (output && stripArtifactMeta(output).length > 40) {
    return stripArtifactMeta(output);
  }
  let best = '';
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const latest = await readIfExists(path.join(base, entry.name, 'latest.md'));
      if (!latest) continue;
      const cleaned = stripArtifactMeta(latest);
      if (cleaned.length > best.length) best = cleaned;
    }
  } catch {
    // ignore
  }
  return best || '(No chapter content was written to disk for this section.)';
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const parts: string[] = [];
  for (const section of SECTIONS) {
    const body = await pickSectionContent(section.taskId, section.prefer);
    parts.push(`## ${section.title}`, '', body, '', '---', '');
  }
  const markdown = parts.join('\n');
  await fs.writeFile(MD_PATH, markdown, 'utf-8');
  const result = await generatePdfFromMarkdown(markdown, PDF_PATH, {
    title: '8-Hour Diet Digital Product',
    subtitle: 'Compiled from pipeline artifacts 1780232293566-8ydoiv0',
  });
  console.log(`Wrote ${result.absPath} (${result.bytes} bytes)`);
  console.log(`Source markdown: ${MD_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});