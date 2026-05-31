/**
 * Validates orchestration task movement: blockers, context propagation,
 * parent completion, artifact folders, and work products.
 *
 * Run: npx ts-node scripts/validate-orchestration-flow.ts
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Task, WorkProduct } from '../src/orchestration/types';
import { taskWorkflow } from '../src/orchestration/task-workflow';
import {
  getRootArtifactRelDir,
  getTaskArtifactRelDir,
  listSiblingTaskArtifactDirs,
} from '../src/orchestration/task-artifacts';

const TERMINAL = new Set(['done', 'cancelled']);
const ORCH_DIR = path.join(process.cwd(), 'workspace', 'orchestration');

interface Finding {
  level: 'ok' | 'warn' | 'error';
  code: string;
  message: string;
  taskId?: string;
}

const findings: Finding[] = [];

function record(level: Finding['level'], code: string, message: string, taskId?: string): void {
  findings.push({ level, code, message, taskId });
}

async function loadJson<T>(file: string): Promise<T> {
  const raw = await fs.readFile(path.join(ORCH_DIR, file), 'utf-8');
  return JSON.parse(raw) as T;
}

function taskById(tasks: Task[], id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

function areBlockersSatisfied(task: Task, tasks: Task[]): boolean {
  const blockers = task.blockedBy ?? [];
  if (blockers.length === 0) return true;
  return blockers.every((id) => {
    const b = taskById(tasks, id);
    return b && TERMINAL.has(b.status);
  });
}

function validateStatusMachine(tasks: Task[]): void {
  for (const task of tasks) {
    if (task.status === 'in_progress' && !task.checkedOutBy) {
      record('warn', 'IN_PROGRESS_NO_CHECKOUT', `in_progress but no checkedOutBy`, task.id);
    }
    if (task.checkedOutBy && task.status !== 'in_progress' && task.status !== 'review') {
      record(
        'warn',
        'CHECKOUT_STALE',
        `checkedOutBy set while status=${task.status}`,
        task.id,
      );
    }
    if (task.status === 'review' && !task.reviewerId) {
      record('warn', 'REVIEW_NO_REVIEWER', `review status without reviewerId`, task.id);
    }
    const blockersOpen = !(task.blockedBy ?? []).every((id) => {
      const b = taskById(tasks, id);
      return b && TERMINAL.has(b.status);
    });
    if (blockersOpen && task.status === 'todo' && areBlockersSatisfied(task, tasks)) {
      record('ok', 'BLOCKERS_SAT_TODO', `ready for pickup (blockers satisfied)`, task.id);
    }
    if (blockersOpen && (task.status === 'todo' || task.status === 'in_progress')) {
      const open = (task.blockedBy ?? []).filter((id) => {
        const b = taskById(tasks, id);
        return !b || !TERMINAL.has(b.status);
      });
      if (open.length > 0) {
        record(
          'warn',
          'BLOCKERS_OPEN',
          `${task.status} but open blockers: ${open.join(', ')}`,
          task.id,
        );
      }
    }
  }
}

function validateParentCompletion(root: Task, tasks: Task[]): void {
  const subtasks = tasks.filter((t) => t.parentTaskId === root.id);
  if (subtasks.length === 0) return;
  const blockedBy = root.blockedBy ?? [];
  const subtaskIds = new Set(subtasks.map((s) => s.id));
  const waitsOnSubtasks =
    blockedBy.length > 0 && blockedBy.every((id) => subtaskIds.has(id));
  const allSubtasksTerminal = subtasks.every((s) => TERMINAL.has(s.status));
  const firstBatchDone = blockedBy.every((id) => {
    const t = taskById(tasks, id);
    return t && TERMINAL.has(t.status);
  });

  if (waitsOnSubtasks && firstBatchDone && !allSubtasksTerminal) {
    record(
      'warn',
      'PARENT_WAITING_NEW_SUBTASKS',
      `Parent blockedBy first batch (all done) but ${subtasks.filter((s) => !TERMINAL.has(s.status)).length} newer subtask(s) still active — parent cannot auto-complete until ALL children done`,
      root.id,
    );
  }
  if (root.status === 'in_progress' && root.checkedOutBy && waitsOnSubtasks) {
    record(
      'warn',
      'PARENT_STUCK_CHECKED_OUT',
      `Manager still checked out while waiting on subtasks — should have been released after delegation`,
      root.id,
    );
  }
  if (allSubtasksTerminal && root.status !== 'done' && root.status !== 'cancelled') {
    record(
      'warn',
      'PARENT_NOT_AUTO_DONE',
      `All ${subtasks.length} subtasks terminal but parent status=${root.status}`,
      root.id,
    );
  }
}

async function validateTransitiveContext(tasks: Task[], workProducts: WorkProduct[]): Promise<void> {
  for (const task of tasks) {
    if (!(task.blockedBy?.length ?? 0)) continue;
    const depCtx = await taskWorkflow.buildDependencyContext(task.id);
    const transitiveIds = await taskWorkflow.collectTransitiveBlockerIds(task.id);
    record(
      'ok',
      'TRANSITIVE_BLOCKERS',
      `"${task.title}" chain: [${transitiveIds.join(' → ')}] (${transitiveIds.length} upstream)`,
      task.id,
    );
    for (const blockerId of transitiveIds) {
      const blocker = taskById(tasks, blockerId);
      const wp = workProducts.filter((p) => p.taskId === blockerId).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!wp?.content?.trim()) {
        record('warn', 'MISSING_WP_CONTENT', `Blocker "${blocker?.title}" has no work product content`, task.id);
      }
      if (!wp?.filePath && !(wp?.assetPaths?.length ?? 0)) {
        record(
          'warn',
          'MISSING_ASSET_PATHS',
          `Blocker "${blocker?.title}" has no filePath/assetPaths (artifact folder may be empty)`,
          task.id,
        );
      }
    }
    const inputCtx = task.inputContext ?? '';
    for (const blockerId of transitiveIds) {
      const blocker = taskById(tasks, blockerId);
      if (blocker && !inputCtx.includes(blocker.title)) {
        record(
          'warn',
          'INPUT_CONTEXT_STALE',
          `inputContext missing upstream "${blocker.title}" — re-unblock or restart server to rebuild`,
          task.id,
        );
      }
    }
    if (depCtx.trim() && !inputCtx.includes('## Upstream outputs')) {
      record('warn', 'NO_UPSTREAM_SECTION', `Has blockers but no ## Upstream outputs in inputContext`, task.id);
    }
  }
}

async function validateArtifactFolders(tasks: Task[]): Promise<void> {
  const activeRoots = [...new Set(tasks.filter((t) => t.source === 'user' && t.status !== 'cancelled').map((t) => t.id))];
  for (const rootId of activeRoots) {
    const rootRel = getRootArtifactRelDir(rootId);
    const rootAbs = path.join(process.cwd(), rootRel);
    try {
      await fs.access(rootAbs);
      const siblings = await listSiblingTaskArtifactDirs(rootId);
      record('ok', 'ARTIFACT_ROOT', `${rootRel}/ exists with ${siblings.length} task folder(s)`);
      for (const sub of tasks.filter((t) => (t.rootTaskId ?? t.id) === rootId && t.source === 'agent')) {
        const rel = getTaskArtifactRelDir({ id: sub.id, rootTaskId: rootId });
        const abs = path.join(process.cwd(), rel);
        try {
          await fs.access(abs);
          const files = await fs.readdir(abs, { recursive: true });
          const fileCount = files.filter((f) => !String(f).endsWith('/')).length;
          if (fileCount === 0) {
            record('warn', 'ARTIFACT_EMPTY', `Task folder exists but empty`, sub.id);
          } else {
            record('ok', 'ARTIFACT_FILES', `${rel}/ has ${fileCount} file(s)`, sub.id);
          }
        } catch {
          if (TERMINAL.has(sub.status) || sub.status === 'review') {
            record(
              'warn',
              'ARTIFACT_MISSING',
              `Done/review task has no artifact folder at ${rel}/ (ran before artifact feature?)`,
              sub.id,
            );
          }
        }
      }
    } catch {
      record('warn', 'ARTIFACT_ROOT_MISSING', `No artifact root at ${rootRel}/ yet`);
    }
  }
}

function validateDuplicates(tasks: Task[]): void {
  const byTitle = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.status === 'cancelled') continue;
    const key = `${t.parentTaskId ?? 'root'}::${t.title.toLowerCase()}`;
    const list = byTitle.get(key) ?? [];
    list.push(t);
    byTitle.set(key, list);
  }
  for (const [key, list] of byTitle) {
    if (list.length > 1) {
      record(
        'warn',
        'DUPLICATE_SUBTASKS',
        `Duplicate titles under same parent: "${key}" → ${list.map((t) => `${t.id}(${t.status})`).join(', ')}`,
      );
    }
  }
}

function printFlowDiagram(tasks: Task[], rootId: string): void {
  const root = taskById(tasks, rootId);
  if (!root) return;
  console.log('\n--- Task flow (active root) ---');
  console.log(`ROOT [${root.status}] ${root.title} (${root.id})`);
  const children = tasks.filter((t) => t.parentTaskId === rootId).sort((a, b) => a.createdAt - b.createdAt);
  for (const child of children) {
    const blockers = (child.blockedBy ?? [])
      .map((id) => taskById(tasks, id)?.title?.slice(0, 24) ?? id)
      .join(', ');
    const deps = blockers ? ` blockedBy=[${blockers}]` : '';
    const checkout = child.checkedOutBy ? ' 🔒' : '';
    console.log(`  ├─ [${child.status}]${checkout} ${child.title}${deps}`);
    console.log(`  │    artifact: ${getTaskArtifactRelDir({ id: child.id, rootTaskId: rootId })}/`);
  }
}

async function main(): Promise<void> {
  console.log('Orchestration flow validation\n');
  const tasks = await loadJson<Task[]>('tasks.json');
  const workProducts = await loadJson<WorkProduct[]>('workProducts.json');

  validateStatusMachine(tasks);
  validateDuplicates(tasks);

  const activeRoot = tasks.find(
    (t) => t.source === 'user' && t.status !== 'cancelled' && t.status !== 'done',
  );
  if (activeRoot) {
    validateParentCompletion(activeRoot, tasks);
    printFlowDiagram(tasks, activeRoot.id);
  }

  await validateTransitiveContext(tasks, workProducts);
  await validateArtifactFolders(tasks);

  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');
  const oks = findings.filter((f) => f.level === 'ok');

  console.log('\n--- Findings ---');
  for (const f of [...errors, ...warns, ...oks]) {
    const icon = f.level === 'error' ? '✗' : f.level === 'warn' ? '⚠' : '✓';
    console.log(`${icon} [${f.code}] ${f.message}${f.taskId ? ` (${f.taskId})` : ''}`);
  }

  console.log(`\nSummary: ${oks.length} ok, ${warns.length} warn, ${errors.length} error`);
  process.exit(errors.length > 0 ? 1 : warns.length > 0 ? 2 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
