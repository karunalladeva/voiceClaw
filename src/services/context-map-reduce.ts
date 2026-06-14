import { bm25RankIndices, tokenize } from '../utils/bm25';
import { truncateToolOutput } from '../utils/tool-output-truncate';

const SECTION_SPLIT = /(?=^#{1,4}\s)/m;

function extractHeaderExcerpt(content: string, maxPara = 200): string {
  const lines = content.split('\n');
  const header = lines.find((l) => /^#{1,4}\s/.test(l)) ?? lines[0] ?? '';
  const body = lines.slice(lines.indexOf(header) + 1).join(' ').trim();
  const para = body.slice(0, maxPara);
  return `${header.trim()}\n${para}`.trim();
}

export async function buildArtifactRagExcerpt(
  artifactPaths: Array<{ relPath: string; content: string }>,
  query: string,
  maxChars: number,
): Promise<string> {
  if (!artifactPaths.length || !query.trim()) return '';

  const mdFiles = artifactPaths.filter(
    (a) => /\.md$/i.test(a.relPath) && !a.relPath.includes('/read_file/'),
  );
  if (!mdFiles.length) return '';

  const docs = mdFiles.map((a) => extractHeaderExcerpt(a.content));
  const ranked = bm25RankIndices(docs, query);
  const lines: string[] = [];
  let len = 0;

  for (const idx of ranked.slice(0, 8)) {
    const file = mdFiles[idx];
    const excerpt = docs[idx];
    const line = `- \`${file.relPath}\`: ${excerpt.replace(/\n+/g, ' ').slice(0, 240)}`;
    if (len + line.length + 2 > maxChars) break;
    lines.push(line);
    len += line.length + 2;
  }

  if (!lines.length) return '';
  const header = 'Relevant artifact excerpts (task-scoped RAG):\n';
  return truncateToolOutput(header + lines.join('\n'), maxChars);
}

export function summarizeMarkdownSections(markdown: string, maxSectionChars = 400): string {
  const trimmed = markdown.trim();
  if (!trimmed) return '';
  const sections = trimmed.split(SECTION_SPLIT).filter((s) => s.trim());
  if (sections.length <= 1) {
    return trimmed.length > maxSectionChars * 2
      ? trimmed.slice(0, maxSectionChars * 2) + '\n\n[... truncated ...]'
      : trimmed;
  }

  const bullets: string[] = [];
  for (const section of sections) {
    const lines = section.trim().split('\n');
    const heading = lines.find((l) => /^#{1,4}\s/.test(l)) ?? lines[0]?.slice(0, 80) ?? 'Section';
    const body = lines.filter((l) => !/^#{1,4}\s/.test(l)).join(' ').trim();
    const firstSentence = body.split(/(?<=[.!?])\s+/)[0]?.slice(0, maxSectionChars) ?? '';
    bullets.push(`- ${heading.replace(/^#+\s*/, '')}: ${firstSentence}`);
  }
  return bullets.join('\n');
}

export function mapReduceUpstreamContext(text: string, thresholdChars: number): string {
  if (text.length <= thresholdChars) return text;
  const summarized = summarizeMarkdownSections(text);
  if (summarized.length >= text.length) {
    return text.slice(0, thresholdChars) + '\n\n[... upstream truncated ...]';
  }
  return (
    `Upstream outputs (summarized — full text in artifact folders):\n\n${summarized}`
  );
}
