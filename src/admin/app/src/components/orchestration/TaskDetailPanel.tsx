import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type {
  Task,
  OrgAgent,
  WorkProduct,
  TaskComment,
  ReviewDecision,
  TaskStatus,
  TaskPriority,
} from '@/types/orchestration';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { MarkdownField } from './MarkdownField';
import { TaskDependencyPicker } from './TaskDependencyPicker';
import { TaskLabelsField, isRootOrchestrationTask } from './TaskLabelsField';
import { TaskAdminActions } from './TaskAdminActions';
import { PipelineWorkflowPanel } from './PipelineWorkflowPanel';
import { WorkProductAssets } from './WorkProductAssets';
import { AWAITING_USER_LABEL, AWAITING_PARENT_LABEL } from './taskStatusHelpers';

const TASK_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
];

interface UpdateTaskPayload {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigneeId?: string | null;
  blockedBy?: string[];
  labels?: string[];
}

interface Props {
  task: Task;
  agents: OrgAgent[];
  tasks: Task[];
  onClose: () => void;
  onUpdateTask: (taskId: string, updates: UpdateTaskPayload) => Promise<void>;
  onReview?: (
    taskId: string,
    payload: {
      reviewerId?: string;
      decision: ReviewDecision;
      notes?: string;
      nextAssigneeId?: string;
    },
  ) => Promise<void>;
  fetchWorkProducts: (taskId: string) => Promise<WorkProduct[]>;
  fetchComments: (taskId: string) => Promise<TaskComment[]>;
  fetchSubtasks?: (taskId: string) => Promise<Task[]>;
  fetchPipelineWorkflow?: (taskId: string) => Promise<import('@/types/orchestration').PipelineWorkflowInfo>;
  delegateTeam?: (taskId: string, options?: { supersede?: boolean; managerId?: string }) => Promise<void>;
  refreshTaskContext?: (taskId: string) => Promise<void>;
  refreshRootContext?: (rootTaskId: string) => Promise<void>;
  requestClarification?: (taskId: string, question: string) => Promise<void>;
  addTaskComment?: (taskId: string, content: string) => Promise<void>;
  onSelectTask?: (task: Task) => void;
  onTasksChanged?: () => void;
}

export function TaskDetailPanel({
  task,
  agents,
  tasks,
  onClose,
  onUpdateTask,
  onReview,
  fetchWorkProducts,
  fetchComments,
  fetchSubtasks,
  fetchPipelineWorkflow,
  delegateTeam,
  refreshTaskContext,
  refreshRootContext,
  requestClarification,
  addTaskComment,
  onSelectTask,
  onTasksChanged,
}: Props) {
  const [workProducts, setWorkProducts] = useState<WorkProduct[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [notes, setNotes] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDesc, setEditDesc] = useState(task.description);
  const [editPriority, setEditPriority] = useState<TaskPriority>(task.priority);
  const [editStatus, setEditStatus] = useState<TaskStatus>(task.status);
  const [editAssignee, setEditAssignee] = useState(task.assigneeId ?? '');
  const [editBlockedBy, setEditBlockedBy] = useState<string[]>(task.blockedBy ?? []);
  const [editLabels, setEditLabels] = useState<string[]>(task.labels ?? []);

  useEffect(() => {
    setEditTitle(task.title);
    setEditDesc(task.description);
    setEditPriority(task.priority);
    setEditStatus(task.status);
    setEditAssignee(task.assigneeId ?? '');
    setEditBlockedBy(task.blockedBy ?? []);
    setEditLabels(task.labels ?? []);
  }, [task]);

  useEffect(() => {
    void (async () => {
      setWorkProducts(await fetchWorkProducts(task.id));
      setComments(await fetchComments(task.id));
    })();
  }, [task.id, fetchWorkProducts, fetchComments]);

  const assignee = agents.find(a => a.id === task.assigneeId);
  const reviewer = agents.find(a => a.id === task.reviewerId);
  const submitter = agents.find(a => a.id === task.submittedById);

  const runReview = async (decision: ReviewDecision) => {
    if (!onReview) return;
    if (decision === 'reassign' && !reassignTo) {
      setSaveError('Select an agent to reassign to.');
      return;
    }
    setLoading(true);
    setSaveError(null);
    try {
      await onReview(task.id, {
        reviewerId: 'admin',
        decision,
        notes: notes || undefined,
        nextAssigneeId: decision === 'reassign' ? reassignTo : undefined,
      });
      onClose();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdits = async () => {
    setLoading(true);
    setSaveError(null);
    try {
      await onUpdateTask(task.id, {
        title: editTitle.trim(),
        description: editDesc.trim(),
        priority: editPriority,
        status: editStatus,
        assigneeId: editAssignee || null,
        blockedBy: editBlockedBy,
        labels: editLabels,
      });
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-gray-800/80 border-gray-700 mb-4">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Edit task</CardTitle>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="outline">{task.status}</Badge>
            <Badge variant="outline">{task.priority}</Badge>
            {task.source && <Badge variant="outline">{task.source} task</Badge>}
            {task.status === 'blocked' && (
              <Badge className="bg-orange-900/40 text-orange-300 border-orange-800">blocked</Badge>
            )}
            {task.labels?.includes(AWAITING_USER_LABEL) && (
              <Badge className="bg-cyan-900/40 text-cyan-300 border-cyan-800">awaiting user</Badge>
            )}
            {task.labels?.includes(AWAITING_PARENT_LABEL) && (
              <Badge className="bg-violet-900/40 text-violet-300 border-violet-800">awaiting parent</Badge>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 text-sm"
        >
          Close
        </button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {saveError && (
          <div className="p-2 rounded border border-red-800 bg-red-950/40 text-xs text-red-300">
            {saveError}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">Title</label>
            <input
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">Status</label>
            <select
              value={editStatus}
              onChange={e => setEditStatus(e.target.value as TaskStatus)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {TASK_STATUSES.map(s => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">Priority</label>
            <select
              value={editPriority}
              onChange={e => setEditPriority(e.target.value as TaskPriority)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">Assignee</label>
            <select
              value={editAssignee}
              onChange={e => setEditAssignee(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Unassigned</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.role})
                </option>
              ))}
            </select>
          </div>
        </div>
        <MarkdownField
          label="Description"
          value={editDesc}
          onChange={setEditDesc}
          minRows={4}
          accent="blue"
        />
        <TaskDependencyPicker
          tasks={tasks}
          excludeTaskId={task.id}
          selectedIds={editBlockedBy}
          onChange={setEditBlockedBy}
        />
        <TaskLabelsField
          labels={editLabels}
          onChange={setEditLabels}
          showPipelineToggle={isRootOrchestrationTask(task)}
        />
        {fetchPipelineWorkflow && (
          <PipelineWorkflowPanel
            task={task}
            tasks={tasks}
            fetchPipelineWorkflow={fetchPipelineWorkflow}
            onSelectTask={onSelectTask}
          />
        )}
        <button
          type="button"
          disabled={loading || !editTitle.trim() || !editDesc.trim()}
          onClick={() => void handleSaveEdits()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-sm font-medium"
        >
          Save changes
        </button>
        {task.reviewChain && task.reviewChain.length > 0 && (
          <p className="text-xs text-gray-500">
            Review chain:{' '}
            {task.reviewChain
              .map(id => agents.find(a => a.id === id)?.name ?? id)
              .join(' → ')}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
          {assignee && <span>Current assignee: {assignee.name}</span>}
          {reviewer && <span>Reviewer: {reviewer.name}</span>}
          {submitter && <span>Submitted by: {submitter.name}</span>}
          {(task.reworkCount ?? 0) > 0 && <span>Reworks: {task.reworkCount}</span>}
        </div>
        {task.inputContext && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1">Upstream outputs</h4>
            <div className="p-2 bg-gray-900/60 rounded border border-gray-700 max-h-40 overflow-y-auto">
              <ChatMarkdown content={task.inputContext} className="text-xs" />
            </div>
          </div>
        )}
        {workProducts.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1">Work products</h4>
            <WorkProductAssets workProducts={workProducts} />
            {workProducts.map(wp => (
              <div
                key={wp.id}
                className="p-2 mb-2 bg-gray-900/60 rounded border border-gray-700 max-h-48 overflow-y-auto"
              >
                <p className="text-xs font-medium text-gray-400 mb-1">{wp.title}</p>
                <ChatMarkdown content={wp.content} className="text-xs" />
              </div>
            ))}
          </div>
        )}
        {comments.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1">Comments</h4>
            {comments.map(c => (
              <p key={c.id} className="text-xs text-gray-400 mb-1">
                {c.content}
              </p>
            ))}
          </div>
        )}
        {onReview &&
          ['review', 'in_progress', 'todo', 'backlog', 'blocked', 'done'].includes(task.status) && (
          <div className="space-y-2 pt-2 border-t border-gray-700">
            <h4 className="text-xs font-medium text-gray-400">Review actions</h4>
            {reviewer && (
              <p className="text-[10px] text-gray-500">
                Reviewer: {reviewer.name}
                {!task.reviewerId && ' (admin override)'}
              </p>
            )}
            {!task.reviewerId && task.status !== 'review' && (
              <p className="text-[10px] text-amber-500/90">
                Set status to Review or save — a reviewer will be assigned from the assignee&apos;s manager.
              </p>
            )}
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Review notes..."
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-xs min-h-[60px]"
            />
            <select
              value={reassignTo}
              onChange={e => setReassignTo(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-xs"
            >
              <option value="">Reassign to...</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => runReview('approve_escalate')}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium disabled:opacity-50"
              >
                Escalate
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => runReview('approve_release')}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-xs font-medium disabled:opacity-50"
              >
                Release
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => runReview('rework')}
                className="px-3 py-1.5 bg-yellow-600/80 hover:bg-yellow-600 rounded text-xs font-medium disabled:opacity-50"
              >
                Rework
              </button>
              <button
                type="button"
                disabled={loading || !reassignTo}
                onClick={() => runReview('reassign')}
                className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs font-medium disabled:opacity-50"
              >
                Reassign
              </button>
              <button
                type="button"
                disabled={loading || !notes.trim()}
                onClick={() => runReview('request_clarification')}
                className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs font-medium disabled:opacity-50"
              >
                Ask user
              </button>
              <button
                type="button"
                disabled={loading || !notes.trim()}
                onClick={() => runReview('escalate_user')}
                className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 rounded text-xs font-medium disabled:opacity-50"
              >
                Escalate user
              </button>
            </div>
            <p className="text-[10px] text-gray-500">
              Rework sends the task back to the worker. Ask user / Escalate require notes.
            </p>
          </div>
        )}
        {fetchSubtasks &&
          delegateTeam &&
          refreshTaskContext &&
          refreshRootContext &&
          requestClarification &&
          addTaskComment && (
          <TaskAdminActions
            task={task}
            agents={agents}
            fetchSubtasks={fetchSubtasks}
            delegateTeam={delegateTeam}
            refreshTaskContext={refreshTaskContext}
            refreshRootContext={refreshRootContext}
            requestClarification={requestClarification}
            addComment={addTaskComment}
            onSubtaskClick={onSelectTask}
            onTasksChanged={async () => {
              setWorkProducts(await fetchWorkProducts(task.id));
              setComments(await fetchComments(task.id));
              onTasksChanged?.();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
