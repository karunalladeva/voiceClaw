const BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  /^accept (all )?cookies/i,
  /^cookie (preferences|settings|policy)/i,
  /^sign in/i,
  /^subscribe to (our )?newsletter/i,
  /^share on (facebook|twitter|linkedin|x)/i,
  /^follow us on/i,
  /^skip to (main )?content/i,
  /^keyboard shortcuts/i,
  /^all rights reserved/i,
  /^privacy policy$/i,
  /^terms of (service|use)$/i,
  /^we use cookies/i,
  /^manage consent/i,
  /^advertisement$/i,
  /^sponsored$/i,
];

const NAV_ONLY_LINK_RATIO = 0.65;

function linkDensity(line: string): number {
  const links = (line.match(/\[([^\]]+)\]\([^)]+\)/g) ?? []).length;
  const words = line.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return links / words;
}

export type MarkdownCleanupResult = {
  text: string;
  removedChars: number;
  removedLines: number;
};

export function stripMarkdownBoilerplate(markdown: string): MarkdownCleanupResult {
  const originalLen = markdown.length;
  const lines = markdown.split('\n');
  const kept: string[] = [];
  let removedLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    if (BOILERPLATE_LINE_PATTERNS.some((re) => re.test(trimmed))) {
      removedLines++;
      continue;
    }
    if (trimmed.startsWith('[') && linkDensity(trimmed) >= NAV_ONLY_LINK_RATIO && trimmed.length < 200) {
      removedLines++;
      continue;
    }
    kept.push(line);
  }

  let text = kept.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
  return {
    text,
    removedChars: Math.max(0, originalLen - text.length),
    removedLines,
  };
}
