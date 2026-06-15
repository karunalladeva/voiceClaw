import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { orchestrationStore, generateId } from './store';
import {
  ensureTaskArtifactDir,
  getTaskArtifactRelDir,
  listTaskArtifactRelPaths,
  writeTaskArtifactManifest,
} from './task-artifacts';
import { hasPipelineModeLabel } from './orchestration-labels';
import {
  isPipelineCoordinatorAwaitingSubtasks,
  isRootPipelineMode,
} from './pipeline-helpers';
import { materializeWorkProductChapters } from './work-product-materializer';
import { agentRegistry } from './agent-registry';
import { companyManager } from './company-manager';
import { normalizeTask, normalizeTasks } from './task-normalizer';
import { configManager } from '../config/index';
import { buildOrgScopeId } from '../platform/session/scope-id';
import { sessionContextService } from '../platform/context/session-context-service';
import {
  mergeUpstreamRegistryEntry,
  formatUpstreamRegistryForPrompt,
} from '../platform/context/upstream-registry';
import type { UpstreamRegistryEntry } from '../platform/contracts';
import type {
  OrgAgent,
  Task,
  WorkProduct,
  ReviewDecision,
  SpawnTaskInput,
  ApprovalRequest,
  TaskPriority,
} from './types';

export class TaskWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskWorkflowError';
  }
}

const TERMINAL_BLOCKER_STATUSES = new Set(['done', 'cancelled']);
const UPSTREAM_OUTPUTS_HEADER = '## Upstream outputs';

function stripUpstreamSection(inputContext: string): string {
  const idx = inputContext.indexOf(UPSTREAM_OUTPUTS_HEADER);
  if (idx === -1) return inputContext.trim();
  return inputContext.slice(0, idx).trim();
}

function mergeInputContextWithUpstream(preserved: string, upstreamMarkdown: string): string {
  const upstream = upstreamMarkdown.trim();
  if (!upstream) return preserved;
  const section = `\n\n${UPSTREAM_OUTPUTS_HEADER}\n\n${upstream}`;
  return preserved ? `${preserved}${section}` : section.trimStart();
}

export interface ReviewDecisionPayload {
  decision: ReviewDecision;
  notes?: string;
  nextAssigneeId?: string;
  spawnTask?: SpawnTaskInput;
}

interface ReviewContext {
  requestedReviewerId: string;
  actingReviewerId: string;
  isHumanActor: boolean;
}

class TaskWorkflowEngine extends EventEmitter {
  private isHumanReviewer(reviewerId: string): boolean {
    return reviewerId === 'admin' || reviewerId === 'human' || reviewerId.startsWith('user');
  }

  private async buildReviewContext(task: Task, requestedReviewerId: string): Promise<ReviewContext> {
    const isHumanActor = this.isHumanReviewer(requestedReviewerId);
    if (!isHumanActor) {
      return {
        requestedReviewerId,
        actingReviewerId: requestedReviewerId,
        isHumanActor: false,
      };
    }
    let actingReviewerId = task.reviewerId;
    if (!actingReviewerId && task.reviewChain?.length) {
      actingReviewerId = task.reviewChain[task.reviewChain.length - 1];
    }
    if (!actingReviewerId && task.assigneeId) {
      const manager = await this.getDirectManager(task.assigneeId);
      actingReviewerId = manager?.id;
    }
    return {
      requestedReviewerId,
      actingReviewerId: actingReviewerId ?? requestedReviewerId,
      isHumanActor: true,
    };
  }

  private assertReviewerPermission(task: Task, ctx: ReviewContext): void {
    if (ctx.isHumanActor) return;
    if (task.reviewerId !== ctx.actingReviewerId) {
      throw new TaskWorkflowError('Not the current reviewer for this task');
    }
  }

  private commentAuthor(ctx: ReviewContext): { authorId: string; authorType: 'agent' | 'human' } {
    if (ctx.isHumanActor) {
      return { authorId: ctx.requestedReviewerId, authorType: 'human' };
    }
    return { authorId: ctx.actingReviewerId, authorType: 'agent' };
  }
  async resolveManagementChain(assigneeId: string): Promise<OrgAgent[]> {
    const chain: OrgAgent[] = [];
    const visited = new Set<string>();
    let current = await agentRegistry.getById(assigneeId);
    while (current?.reportsTo) {
      if (visited.has(current.reportsTo)) {
        throw new TaskWorkflowError('reportsTo cycle detected in management chain');
      }
      visited.add(current.reportsTo);
      const manager = await agentRegistry.getById(current.reportsTo);
      if (!manager) break;
      chain.push(manager);
      current = manager;
    }
    return chain;
  }

  async getDirectManager(assigneeId: string): Promise<OrgAgent | null> {
    const assignee = await agentRegistry.getById(assigneeId);
    if (!assignee?.reportsTo) return null;
    return (await agentRegistry.getById(assignee.reportsTo)) ?? null;
  }

  async isChainTop(agentId: string): Promise<boolean> {
    const agent = await agentRegistry.getById(agentId);
    return !agent?.reportsTo;
  }

  async validateReportsToAcyclic(companyId: string, candidateReportsTo?: string, agentId?: string): Promise<void> {
    if (!candidateReportsTo) return;
    const agents = await agentRegistry.getByCompany(companyId);
    const byId = new Map(agents.map(a => [a.id, a]));
    let cursor: string | undefined = candidateReportsTo;
    const visited = new Set<string>();
    if (agentId) visited.add(agentId);
    while (cursor) {
      if (visited.has(cursor)) {
        throw new TaskWorkflowError('reportsTo would create a cycle in the org chart');
      }
      visited.add(cursor);
      cursor = byId.get(cursor)?.reportsTo;
    }
  }

  async findCompanyRootAgent(companyId: string): Promise<OrgAgent | undefined> {
    const agents = await agentRegistry.getByCompany(companyId);
    const roots = agents.filter(a => !a.reportsTo && a.status !== 'terminated');
    const ceo = roots.find(a => a.role === 'ceo');
    return ceo ?? roots[0];
  }

  private async loadTask(taskId: string): Promise<Task> {
    const tasks = await orchestrationStore.load('tasks');
    const task = tasks.find(t => t.id === taskId);
    if (!task) throw new TaskWorkflowError(`Task not found: ${taskId}`);
    return normalizeTask(task);
  }

  private async tryLoadTask(taskId: string): Promise<Task | null> {
    try {
      return await this.loadTask(taskId);
    } catch {
      return null;
    }
  }

  private async saveTask(updated: Task): Promise<Task> {
    return orchestrationStore.mutateTasks((tasks) => {
      const index = tasks.findIndex((t) => t.id === updated.id);
      if (index === -1) throw new TaskWorkflowError(`Task not found: ${updated.id}`);
      tasks[index] = { ...updated, updatedAt: Date.now() };
      return tasks[index];
    });
  }

  async areBlockersSatisfied(task: Task): Promise<boolean> {
    if (!task.blockedBy?.length) return true;
    for (const blockerId of task.blockedBy) {
      let blocker: Task;
      try {
        blocker = await this.loadTask(blockerId);
      } catch {
        return false;
      }
      if (!TERMINAL_BLOCKER_STATUSES.has(blocker.status)) return false;
    }
    return true;
  }

  async isRootTaskActive(task: Task): Promise<boolean> {
    const rootId = task.rootTaskId ?? task.id;
    const root = rootId === task.id ? task : await this.loadTask(rootId);
    if (root.status === 'cancelled') return false;
    if (root.status === 'backlog') {
      const subtasks = (await orchestrationStore.load('tasks')).filter(
        (t) => t.parentTaskId === root.id,
      );
      if (subtasks.length > 0 && (root.blockedBy?.length ?? 0) > 0) {
        return true;
      }
      return false;
    }
    return true;
  }

  async canCheckout(taskId: string, agentId: string): Promise<void> {
    const task = await this.loadTask(taskId);
    if (task.assigneeId && task.assigneeId !== agentId) {
      throw new TaskWorkflowError('Task is not assigned to this agent');
    }
    if (!(await this.areBlockersSatisfied(task))) {
      throw new TaskWorkflowError('Task is blocked by incomplete dependencies');
    }
    const rootId = task.rootTaskId ?? task.id;
    if (rootId !== task.id && !(await this.isRootTaskActive(task))) {
      throw new TaskWorkflowError('Root task is not active yet');
    }
    if (task.source === 'agent' && !task.rootTaskId) {
      throw new TaskWorkflowError('Agent task must reference a root task');
    }
    const allTasks = await orchestrationStore.load('tasks');
    const rootIsPipeline = await isRootPipelineMode(task, (id) => this.loadTask(id));
    if (
      isPipelineCoordinatorAwaitingSubtasks(task, allTasks, rootIsPipeline)
    ) {
      throw new TaskWorkflowError(
        'Pipeline coordinator parent cannot checkout while subtasks are in progress',
      );
    }
  }

  async saveWorkProduct(
    taskId: string,
    agentId: string,
    workProduct?: Partial<WorkProduct>,
  ): Promise<WorkProduct | null> {
    if (!workProduct) return null;
    const task = await this.loadTask(taskId);
    const scope = { id: task.id, rootTaskId: task.rootTaskId ?? task.id };
    const artifactRelDir = getTaskArtifactRelDir(scope);
    await ensureTaskArtifactDir(scope);
    if (workProduct.content?.trim()) {
      await fs.writeFile(
        path.join(process.cwd(), artifactRelDir, 'output.md'),
        workProduct.content.trim(),
        'utf-8',
      );
    }
    const products = await orchestrationStore.load('workProducts');
    const scannedAssets = await listTaskArtifactRelPaths(scope);
    const declaredAssets = workProduct.assetPaths?.filter((p) => p?.trim()).map((p) => p.trim()) ?? [];
    const assetPaths = [...new Set([...declaredAssets, ...scannedAssets])];
    const product: WorkProduct = {
      id: generateId(),
      taskId,
      agentId,
      type: workProduct.type || 'artifact',
      title: workProduct.title || `Output for ${task.title}`,
      content: workProduct.content || '',
      filePath: workProduct.filePath?.trim() || `${artifactRelDir}/`,
      assetPaths,
      createdAt: Date.now(),
    };
    await writeTaskArtifactManifest(scope, {
      title: product.title,
      assetPaths: product.assetPaths,
    });
    products.push(product);
    await orchestrationStore.save('workProducts', products);
    if (workProduct.content?.trim()) {
      const materialized = await materializeWorkProductChapters(
        taskId,
        task.rootTaskId ?? task.id,
        workProduct.content,
        product.title,
      );
      if (materialized.writtenPaths.length > 0) {
        product.assetPaths = [
          ...new Set([...(product.assetPaths ?? []), ...materialized.writtenPaths]),
        ];
        const idx = products.findIndex((p) => p.id === product.id);
        if (idx >= 0) {
          products[idx] = product;
          await orchestrationStore.save('workProducts', products);
        }
      }
    }
    return product;
  }

  async getLatestWorkProduct(taskId: string): Promise<WorkProduct | undefined> {
    const products = await orchestrationStore.load('workProducts');
    const forTask = products.filter(p => p.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt);
    return forTask[0];
  }

  /** All upstream blockers in dependency order (deepest first, direct blockers last). */
  async collectTransitiveBlockerIds(taskId: string): Promise<string[]> {
    const task = await this.loadTask(taskId);
    const directBlockers = task.blockedBy ?? [];
    if (directBlockers.length === 0) return [];
    const seen = new Set<string>();
    const ordered: string[] = [];
    const visit = async (blockerId: string): Promise<void> => {
      if (seen.has(blockerId)) return;
      seen.add(blockerId);
      const blocker = await this.tryLoadTask(blockerId);
      if (!blocker) {
        console.warn(
          `[TaskWorkflow] Skipping missing blocker ${blockerId} while resolving dependencies for ${taskId}`,
        );
        return;
      }
      for (const upstreamId of blocker.blockedBy ?? []) {
        await visit(upstreamId);
      }
      ordered.push(blockerId);
    };
    for (const blockerId of directBlockers) {
      await visit(blockerId);
    }
    return ordered;
  }

  formatBlockerOutputSection(blocker: Task, wp: WorkProduct | undefined): string {
    const artifactDir = getTaskArtifactRelDir({
      id: blocker.id,
      rootTaskId: blocker.rootTaskId ?? blocker.id,
    });
    const parts = [`### ${blocker.title} (${blocker.id})`, `**Artifact folder:** \`${artifactDir}/\``];
    if (!wp) {
      parts.push('_(no work product recorded)_');
      return parts.join('\n\n');
    }
    if (wp.content?.trim()) parts.push(wp.content.trim());
    const assets: string[] = [];
    if (wp.filePath?.trim()) assets.push(wp.filePath.trim());
    for (const assetPath of wp.assetPaths ?? []) {
      const trimmed = assetPath?.trim();
      if (trimmed && !assets.includes(trimmed)) assets.push(trimmed);
    }
    if (!assets.includes(`${artifactDir}/`)) assets.unshift(`${artifactDir}/`);
    if (assets.length > 0) {
      parts.push(`**Asset paths:**\n${assets.map((p) => `- \`${p}\``).join('\n')}`);
    }
    if (!wp.content?.trim() && assets.length === 0) {
      parts.push('_(no work product recorded)_');
    }
    return parts.join('\n\n');
  }

  async buildDependencyContext(taskId: string): Promise<string> {
    const blockerIds = await this.collectTransitiveBlockerIds(taskId);
    if (blockerIds.length === 0) return '';
    const task = await this.loadTask(taskId);
    const rootId = task.rootTaskId ?? task.id;
    const useRegistry =
      configManager.getConfig().agent?.context?.orgLifecycleContext?.enabled !== false;
    if (useRegistry) {
      const scopeId = buildOrgScopeId(rootId, taskId);
      for (const blockerId of blockerIds) {
        const blocker = await this.tryLoadTask(blockerId);
        if (!blocker) continue;
        const wp = await this.getLatestWorkProduct(blockerId);
        const body = this.formatBlockerOutputSection(blocker, wp);
        const pointer = await sessionContextService.registerPayload(scopeId, body, {
          kind: 'artifact',
          title: blocker.title.slice(0, 120),
          summary: (wp?.content?.trim() || body).slice(0, 2000),
        });
        const entry: UpstreamRegistryEntry = {
          blockerTaskId: blockerId,
          pointerId: pointer.id,
          title: blocker.title,
          summary: pointer.summary,
          status: blocker.status === 'review' ? 'review' : 'done',
        };
        await mergeUpstreamRegistryEntry(scopeId, rootId, taskId, entry);
      }
      const registry = await sessionContextService.loadUpstreamRegistry(scopeId, taskId);
      if (registry && registry.entries.length > 0) {
        return (
          `Upstream outputs are registered as pointers — call \`read_pointer\` for full payloads.\n\n` +
          formatUpstreamRegistryForPrompt(registry)
        );
      }
    }
    const parts: string[] = [];
    for (const blockerId of blockerIds) {
      const blocker = await this.tryLoadTask(blockerId);
      if (!blocker) continue;
      const wp = await this.getLatestWorkProduct(blockerId);
      parts.push(this.formatBlockerOutputSection(blocker, wp));
    }
    return parts.join('\n\n');
  }

  async refreshUpstreamContext(taskId: string): Promise<Task> {
    const task = await this.loadTask(taskId);
    const depContext = await this.buildDependencyContext(taskId);
    const preserved = stripUpstreamSection(task.inputContext ?? '');
    const inputContext = mergeInputContextWithUpstream(preserved, depContext);
    return this.saveTask({ ...task, inputContext });
  }

  async refreshUpstreamContextForRoot(rootTaskId: string): Promise<Task[]> {
    const tasks = await orchestrationStore.load('tasks');
    const underRoot = tasks.filter(
      (t) => t.id === rootTaskId || t.rootTaskId === rootTaskId,
    );
    const refreshed: Task[] = [];
    for (const t of underRoot) {
      if (t.status === 'done' || t.status === 'cancelled') continue;
      refreshed.push(await this.refreshUpstreamContext(t.id));
    }
    return refreshed;
  }

  /** Dual-gate auto approve_release for pipeline worker leaf subtasks. */
  async tryAutoReleasePipelineSubtask(taskId: string): Promise<Task | null> {
    const task = await this.loadTask(taskId);
    if (task.status !== 'review') return null;
    const rootId = task.rootTaskId ?? task.id;
    const root = rootId === task.id ? task : await this.loadTask(rootId);
    if (!hasPipelineModeLabel(root.labels)) return null;
    if (rootId === task.id) return null;
    const subtasks = (await orchestrationStore.load('tasks')).filter(
      (t) => t.parentTaskId === task.id,
    );
    if (subtasks.length > 0) return null;
    const company = await companyManager.getById(task.companyId);
    if (!company?.settings.autoReleasePipelineSubtasks) return null;
    const reviewerId = task.reviewerId;
    if (!reviewerId) return null;
    const ctx = await this.buildReviewContext(task, reviewerId);
    const released = await this.approveRelease(taskId, ctx, {
      decision: 'approve_release',
      notes: 'Auto-released (pipeline-mode + autoReleasePipelineSubtasks)',
    });
    console.log(`[Orchestration] task:auto_released_pipeline ${taskId} (${task.title})`);
    return released;
  }

  async submitForReview(
    taskId: string,
    agentId: string,
    workProduct?: Partial<WorkProduct>,
  ): Promise<Task> {
    const task = await this.loadTask(taskId);
    const workerId = task.submittedById ?? task.assigneeId ?? agentId;
    await this.saveWorkProduct(taskId, agentId, workProduct);
    const chain = await this.resolveManagementChain(workerId);
    if (chain.length === 0) {
      return this.markDoneAndUnblock(taskId, agentId);
    }
    const reviewer = chain[0];
    task.status = 'review';
    task.submittedById = workerId;
    task.submittedAt = Date.now();
    task.reviewerId = reviewer.id;
    task.reviewChain = chain.map(m => m.id);
    task.checkedOutBy = undefined;
    task.checkedOutAt = undefined;
    const saved = await this.saveTask(task);
    this.emit('task:review_needed', saved);
    return saved;
  }

  private async markDoneAndUnblock(taskId: string, actorId: string): Promise<Task> {
    const task = await orchestrationStore.mutateTasks((tasks) => {
      const t = tasks.find((x) => x.id === taskId);
      if (!t) throw new TaskWorkflowError(`Task not found: ${taskId}`);
      t.status = 'done';
      t.completedAt = Date.now();
      t.reviewerId = undefined;
      t.checkedOutBy = undefined;
      t.checkedOutAt = undefined;
      t.updatedAt = Date.now();
      return normalizeTask(t);
    });
    if (!task.rootTaskId) {
      void import('../models/model-load-coordinator').then(({ modelLoadCoordinator }) => {
        modelLoadCoordinator.unpinPipeline(task.id);
      });
    }
    await this.unblockDependents(taskId);
    this.emit('task:completed', task);
    return task;
  }

  async approveEscalate(taskId: string, ctx: ReviewContext, notes?: string): Promise<Task> {
    const task = await this.loadTask(taskId);
    this.assertReviewerPermission(task, ctx);
    if (task.status !== 'review') {
      throw new TaskWorkflowError('Task is not in review');
    }
    const manager = await agentRegistry.getById(ctx.actingReviewerId);
    if (!manager?.reportsTo) {
      throw new TaskWorkflowError('Cannot escalate: reviewer is at chain top; use approve_release');
    }
    const parent = await agentRegistry.getById(manager.reportsTo);
    if (!parent) throw new TaskWorkflowError('Parent manager not found');
    if (notes) {
      const author = this.commentAuthor(ctx);
      await this.addCommentInternal(taskId, author.authorId, author.authorType, `[Escalate] ${notes}`);
    }
    task.reviewerId = parent.id;
    const saved = await this.saveTask(task);
    this.emit('task:review_needed', saved);
    return saved;
  }

  async canRelease(reviewerId: string): Promise<boolean> {
    if (await this.isChainTop(reviewerId)) return true;
    const agent = await agentRegistry.getById(reviewerId);
    return Boolean(agent?.permissions.canApproveWork);
  }

  async approveRelease(
    taskId: string,
    ctx: ReviewContext,
    payload?: ReviewDecisionPayload,
  ): Promise<Task> {
    const task = await this.loadTask(taskId);
    this.assertReviewerPermission(task, ctx);
    if (!(await this.canRelease(ctx.actingReviewerId))) {
      throw new TaskWorkflowError('Reviewer cannot release; escalate to manager first');
    }
    if (payload?.notes) {
      const author = this.commentAuthor(ctx);
      await this.addCommentInternal(taskId, author.authorId, author.authorType, `[Approved] ${payload.notes}`);
    }
    if (payload?.spawnTask) {
      await this.spawnTask(task, payload.spawnTask);
    }
    if (payload?.nextAssigneeId) {
      await orchestrationStore.mutateTasks((tasks) => {
        const t = tasks.find((x) => x.id === taskId);
        if (t) t.assigneeId = payload.nextAssigneeId;
      });
    }
    return this.markDoneAndUnblock(taskId, ctx.actingReviewerId);
  }

  async requestRework(taskId: string, ctx: ReviewContext, notes: string): Promise<Task> {
    const task = await this.loadTask(taskId);
    this.assertReviewerPermission(task, ctx);
    if (!ctx.isHumanActor && task.status !== 'review') {
      throw new TaskWorkflowError('Task is not in review');
    }
    if (
      ctx.isHumanActor &&
      !['review', 'todo', 'in_progress', 'backlog', 'blocked', 'done'].includes(task.status)
    ) {
      throw new TaskWorkflowError(`Cannot rework task in status: ${task.status}`);
    }
    const company = await companyManager.getById(task.companyId);
    const maxRework = company?.settings.maxReworkAttempts ?? 3;
    const reworkCount = (task.reworkCount ?? 0) + 1;
    if (reworkCount > maxRework) {
      throw new TaskWorkflowError(`Maximum rework attempts (${maxRework}) exceeded`);
    }
    const author = this.commentAuthor(ctx);
    await this.addCommentInternal(taskId, author.authorId, author.authorType, `[Rework] ${notes}`);
    const workerId = task.submittedById ?? task.assigneeId;
    task.status = 'todo';
    task.completedAt = undefined;
    task.reviewerId = undefined;
    task.reviewChain = undefined;
    task.submittedAt = undefined;
    task.reworkCount = reworkCount;
    task.assigneeId = workerId;
    task.checkedOutBy = undefined;
    task.checkedOutAt = undefined;
    const saved = await this.saveTask(task);
    if (workerId) this.emit('task:created', saved);
    return saved;
  }

  async reassign(
    taskId: string,
    ctx: ReviewContext,
    newAssigneeId: string,
    notes?: string,
  ): Promise<Task> {
    const task = await this.loadTask(taskId);
    this.assertReviewerPermission(task, ctx);
    const assignee = await agentRegistry.getById(newAssigneeId);
    if (!assignee) throw new TaskWorkflowError(`Assignee not found: ${newAssigneeId}`);
    if (notes) {
      const author = this.commentAuthor(ctx);
      await this.addCommentInternal(taskId, author.authorId, author.authorType, `[Reassign] ${notes}`);
    }
    task.assigneeId = newAssigneeId;
    task.status = 'todo';
    task.reviewerId = undefined;
    task.reviewChain = undefined;
    task.submittedById = undefined;
    task.submittedAt = undefined;
    task.checkedOutBy = undefined;
    task.checkedOutAt = undefined;
    const saved = await this.saveTask(task);
    this.emit('task:created', saved);
    return saved;
  }

  async processReviewDecision(
    taskId: string,
    reviewerId: string,
    payload: ReviewDecisionPayload,
  ): Promise<Task> {
    const task = await this.loadTask(taskId);
    const ctx = await this.buildReviewContext(task, reviewerId);
    switch (payload.decision) {
      case 'approve_escalate':
        return this.approveEscalate(taskId, ctx, payload.notes);
      case 'approve_release':
        return this.approveRelease(taskId, ctx, payload);
      case 'rework':
        return this.requestRework(taskId, ctx, payload.notes || 'Rework requested');
      case 'reassign':
        if (!payload.nextAssigneeId) {
          throw new TaskWorkflowError('nextAssigneeId required for reassign');
        }
        return this.reassign(taskId, ctx, payload.nextAssigneeId, payload.notes);
      case 'escalate_user':
      case 'request_clarification':
        return this.escalateToUser(taskId, ctx.actingReviewerId, payload.decision, payload.notes || '');
      default:
        throw new TaskWorkflowError(`Unknown decision: ${payload.decision}`);
    }
  }

  async escalateToUser(
    taskId: string,
    agentId: string,
    kind: 'escalate_user' | 'request_clarification',
    reason: string,
  ): Promise<Task> {
    const task = await this.loadTask(taskId);
    const approvals = await orchestrationStore.load('approvals');
    const approval: ApprovalRequest = {
      id: generateId(),
      companyId: task.companyId,
      type: kind === 'request_clarification' ? 'clarification' : 'work_escalation',
      requesterId: agentId,
      requesterType: 'agent',
      title:
        kind === 'request_clarification'
          ? `Clarification needed: ${task.title}`
          : `Approval needed: ${task.title}`,
      description: reason,
      data: { taskId, task, kind },
      status: 'pending',
      createdAt: Date.now(),
    };
    approvals.push(approval);
    await orchestrationStore.save('approvals', approvals);
    task.status = 'blocked';
    const saved = await this.saveTask(task);
    return saved;
  }

  private async spawnTask(parent: Task, input: SpawnTaskInput): Promise<Task> {
    return orchestrationStore.mutateTasks((tasks) => {
      const child: Task = normalizeTask({
        id: generateId(),
        companyId: parent.companyId,
        goalId: parent.goalId,
        parentTaskId: parent.id,
        rootTaskId: parent.rootTaskId ?? parent.id,
        source: 'agent',
        title: input.title,
        description: input.description,
        status: 'todo',
        priority: input.priority ?? parent.priority,
        assigneeId: input.assigneeId,
        createdBy: parent.reviewerId ?? parent.assigneeId ?? 'system',
        blockedBy: input.blockedBy ?? [],
        labels: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      tasks.push(child);
      this.emit('task:created', child);
      return child;
    });
  }

  async unblockDependents(completedTaskId: string): Promise<Task[]> {
    const unblocked: Task[] = [];
    await orchestrationStore.mutateTasks(async (tasks) => {
      for (const task of tasks) {
        if (!task.blockedBy?.includes(completedTaskId)) continue;
        const normalized = normalizeTask(task);
        if (!(await this.areBlockersSatisfied(normalized))) continue;
        if (task.status !== 'backlog' && task.status !== 'todo') continue;
        const depContext = await this.buildDependencyContext(task.id);
        const preserved = stripUpstreamSection(task.inputContext ?? '');
        task.inputContext = mergeInputContextWithUpstream(preserved, depContext);
        if (task.status === 'backlog') task.status = 'todo';
        task.updatedAt = Date.now();
        unblocked.push(normalizeTask(task));
      }
    });
    for (const t of unblocked) {
      this.emit('task:unblocked', t);
      if (t.assigneeId) this.emit('task:created', t);
    }
    return unblocked;
  }

  async getReviewQueue(agentId: string): Promise<Task[]> {
    const tasks = await orchestrationStore.load('tasks');
    return normalizeTasks(
      tasks.filter(t => t.status === 'review' && t.reviewerId === agentId),
    );
  }

  private async addCommentInternal(
    taskId: string,
    authorId: string,
    authorType: 'agent' | 'human',
    content: string,
  ): Promise<void> {
    const comments = await orchestrationStore.load('comments');
    comments.push({
      id: generateId(),
      taskId,
      authorId,
      authorType,
      content,
      createdAt: Date.now(),
    });
    await orchestrationStore.save('comments', comments);
  }
}

export const taskWorkflow = new TaskWorkflowEngine();
