import * as fs from 'fs/promises';
import * as path from 'path';
import { companyManager } from './company-manager';
import { hasPipelineModeLabel } from './orchestration-labels';
import { taskManager } from './task-manager';
import { getRootArtifactAbsDir, getTaskArtifactAbsDir } from './task-artifacts';
import { OUTPUTS_DOCUMENTS_DIR } from '../utils/workspace-dirs';
import type { ApprovalRequest, Task } from './types';

function isCreatedTask(value: Task | ApprovalRequest): value is Task {
  return 'status' in value && 'assigneeId' in value;
}

export const CHAPTER_SPLIT_LABEL = 'chapter-split';
export const CHAPTER_SPLIT_SOURCE_LABEL = 'chapter-split-source';

const CHAPTER_DRAFT_PATTERN =
  /chapter|content gap|chapter drafting|draft.*chapter|write comprehensive.*chapter|minimum \d+ chapter/i;

export function isChapterDraftingTask(task: Task): boolean {
  if (task.labels?.includes(CHAPTER_SPLIT_LABEL)) return false;
  if (task.labels?.includes(CHAPTER_SPLIT_SOURCE_LABEL)) return false;
  const haystack = `${task.title}\n${task.description}`;
  return CHAPTER_DRAFT_PATTERN.test(haystack);
}

/** Parse `## Chapter …` headings from a TOC markdown file. */
export function parseChapterTitlesFromMarkdown(content: string): string[] {
  const titles: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^##\s+(Chapter\s+.+|Chapter\s+\d+.+)$/i);
    if (match) titles.push(match[1].trim());
  }
  return titles;
}

function parseMinimumChapterCount(description: string): number | null {
  const match = description.match(/minimum\s+(\d+)\s+chapter/i);
  if (!match) return null;
  const count = Number.parseInt(match[1], 10);
  return Number.isFinite(count) && count >= 2 ? count : null;
}

function buildGenericChapterTitles(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return `Chapter ${n}`;
  });
}

async function readTextIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

export async function resolveChapterTitles(rootTaskId: string, task: Task): Promise<string[]> {
  const tocCandidates = [
    path.join(getTaskArtifactAbsDir({ id: task.id, rootTaskId }), 'TOC.md'),
    path.join(getRootArtifactAbsDir(rootTaskId), 'TOC.md'),
    path.join(OUTPUTS_DOCUMENTS_DIR, 'TOC.md'),
  ];
  for (const absPath of tocCandidates) {
    const content = await readTextIfExists(absPath);
    if (!content) continue;
    const parsed = parseChapterTitlesFromMarkdown(content);
    if (parsed.length >= 2) return parsed;
  }
  const minChapters = parseMinimumChapterCount(task.description);
  if (minChapters) return buildGenericChapterTitles(minChapters);
  return [];
}

function buildChapterTaskDescription(chapterTitle: string, source: Task, rootTaskId: string): string {
  const slug = chapterTitle
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return [
    `Write **${chapterTitle}** for the digital product pipeline.`,
    '',
    '**Deliverables:**',
    `- 1500–2500 words of rich, non-repetitive content`,
    `- Actionable tips and examples where relevant`,
    `- Save as \`${slug}.md\` under workspace/orchestration/artifacts/${rootTaskId}/`,
    `- Use digital-product-content-writer if needed`,
    '',
    '**Source task context:**',
    source.description.split('\n').slice(0, 12).join('\n'),
  ].join('\n');
}

export async function splitChapterSubtaskIfEnabled(
  monolithic: Task,
  creatorId: string,
): Promise<Task[]> {
  if (!monolithic.parentTaskId || !monolithic.assigneeId) return [];
  if (monolithic.labels?.includes(CHAPTER_SPLIT_SOURCE_LABEL)) return [];
  if (!isChapterDraftingTask(monolithic)) return [];

  const rootId = monolithic.rootTaskId ?? monolithic.parentTaskId;
  const root =
    rootId === monolithic.id ? monolithic : await taskManager.getTaskById(rootId);
  if (!root || !hasPipelineModeLabel(root.labels)) return [];

  const company = await companyManager.getById(monolithic.companyId);
  if (!company?.settings.splitChapterSubtasks) return [];

  const existingChildren = await taskManager.getSubtasks(monolithic.id);
  if (existingChildren.some((t) => t.labels?.includes(CHAPTER_SPLIT_LABEL))) return [];

  const chapters = await resolveChapterTitles(rootId, monolithic);
  if (chapters.length < 2) {
    console.log(
      `[Orchestration] Chapter split skipped for "${monolithic.title}" — no TOC or chapter count found`,
    );
    return [];
  }

  const created: Task[] = [];
  let lastChapterId: string | undefined;
  const inheritedBlockers = monolithic.blockedBy ?? [];

  for (const chapterTitle of chapters) {
    const result = await taskManager.createSubtask(monolithic.parentTaskId, {
      title: `Write ${chapterTitle}`,
      description: buildChapterTaskDescription(chapterTitle, monolithic, rootId),
      assigneeId: monolithic.assigneeId,
      priority: monolithic.priority,
      blockedBy: lastChapterId ? [lastChapterId] : inheritedBlockers,
      createdBy: creatorId,
      labels: [CHAPTER_SPLIT_LABEL],
    });
    if (!isCreatedTask(result)) continue;
    created.push(result);
    lastChapterId = result.id;
    console.log(
      `[Orchestration] Chapter subtask "${result.title}" → ${result.assigneeId} (${result.status})`,
    );
  }

  if (created.length === 0) return [];

  await taskManager.updateTask(
    monolithic.id,
    {
      status: 'cancelled',
      labels: [...new Set([...(monolithic.labels ?? []), CHAPTER_SPLIT_SOURCE_LABEL])],
    },
    creatorId,
  );
  console.log(
    `[Orchestration] Split "${monolithic.title}" into ${created.length} chapter subtask(s); source cancelled`,
  );
  return created;
}
