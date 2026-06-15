import * as fs from 'fs/promises';
import * as path from 'path';

const ARTIFACT_STAMP_PATTERN = /^\d{10,}$/;

/** Tool audit files like read_pointer/1781549740024.md — not HandoffPointer UUIDs. */
export function looksLikeArtifactAuditStamp(pointerId: string): boolean {
  return ARTIFACT_STAMP_PATTERN.test(pointerId.trim());
}

async function walkFindStampMd(
  dir: string,
  stamp: string,
  depth: number,
): Promise<string | null> {
  if (depth > 6) return null;
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkFindStampMd(abs, stamp, depth + 1);
      if (nested) return nested;
      continue;
    }
    if (entry.name === `${stamp}.md`) {
      try {
        return await fs.readFile(abs, 'utf-8');
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function readOrgArtifactAuditStamp(
  rootTaskId: string,
  stamp: string,
): Promise<string | null> {
  if (!looksLikeArtifactAuditStamp(stamp)) return null;
  const rootAbs = path.join(process.cwd(), 'workspace', 'orchestration', 'artifacts', rootTaskId);
  return walkFindStampMd(rootAbs, stamp, 0);
}
