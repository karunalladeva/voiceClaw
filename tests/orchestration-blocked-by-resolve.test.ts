/**
 * Run: npx ts-node tests/orchestration-blocked-by-resolve.test.ts
 */
import assert from 'node:assert/strict';
import { resolveBlockedByRefs } from '../src/orchestration/orchestration-blocked-by-resolve';
import { normalizeBlockedByIds } from '../src/orchestration/orchestration-blocked-by';
import type { Task } from '../src/orchestration/types';

function makeTask(partial: Partial<Task> & { id: string; title: string }): Task {
  return {
    companyId: 'co',
    description: '',
    status: 'todo',
    priority: 'medium',
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    source: 'agent',
    labels: [],
    ...partial,
  } as Task;
}

function testPhaseIdResolution(): void {
  const parent = makeTask({ id: 'parent-1', title: 'Epic' });
  const research = makeTask({ id: '1781553237759-wk88wri', title: 'Market Research', createdAt: 100 });
  const createdByTitle = new Map<string, string>([['market research', research.id]]);
  const createdByPhaseId = new Map<string, string>([['market-research', research.id]]);
  const { resolved, unresolved } = resolveBlockedByRefs(['market-research'], {
    parentTask: parent,
    createdByTitle,
    createdByPhaseId,
    existingSubtasks: [research],
    lastCreatedId: research.id,
  });
  assert.deepEqual(resolved, [research.id]);
  assert.deepEqual(unresolved, []);
}

function testFuzzyTitleWithNewline(): void {
  const parent = makeTask({ id: 'parent-1', title: 'Epic' });
  const research = makeTask({
    id: '1781553237759-wk88wri',
    title: 'Market Research - Find Top 5 Amazon Best-Selling Ebooks with Sales Validation\n',
    createdAt: 100,
  });
  const { resolved } = resolveBlockedByRefs(
    ['Market Research - Find Top 5 Amazon Best-Selling Ebooks with Sales Validation'],
    {
      parentTask: parent,
      createdByTitle: new Map(),
      createdByPhaseId: new Map(),
      existingSubtasks: [research],
    },
  );
  assert.deepEqual(resolved, [research.id]);
}

function testPreviousUsesMostRecentSibling(): void {
  const parent = makeTask({ id: 'parent-1', title: 'Epic' });
  const older = makeTask({ id: 'task-old', title: 'Phase A', createdAt: 100 });
  const newer = makeTask({ id: 'task-new', title: 'Phase B', createdAt: 200 });
  const { resolved } = resolveBlockedByRefs(['previous'], {
    parentTask: parent,
    createdByTitle: new Map(),
    createdByPhaseId: new Map(),
    existingSubtasks: [older, newer],
  });
  assert.deepEqual(resolved, [newer.id]);
}

function testBatchPhaseChain(): void {
  const parent = makeTask({ id: 'parent-1', title: 'Epic' });
  const createdByTitle = new Map<string, string>();
  const createdByPhaseId = new Map<string, string>();
  const existingSubtasks: Task[] = [];

  const research = makeTask({ id: 't-research', title: 'Market Research', createdAt: 1 });
  createdByTitle.set('market research', research.id);
  createdByPhaseId.set('market-research', research.id);
  existingSubtasks.push(research);

  const { resolved } = resolveBlockedByRefs(['market-research'], {
    parentTask: parent,
    createdByTitle,
    createdByPhaseId,
    existingSubtasks,
    lastCreatedId: research.id,
  });
  assert.deepEqual(resolved, [research.id]);
}

function testNormalizeBlockedByIdsFuzzy(): void {
  const tasks = [
    makeTask({ id: 't1', title: 'Product Engineering', createdAt: 1 }),
  ];
  const ids = normalizeBlockedByIds(['product engineering'], tasks);
  assert.deepEqual(ids, ['t1']);
}

function run(): void {
  testPhaseIdResolution();
  testFuzzyTitleWithNewline();
  testPreviousUsesMostRecentSibling();
  testBatchPhaseChain();
  testNormalizeBlockedByIdsFuzzy();
  console.log('orchestration-blocked-by-resolve: all tests passed');
}

run();
