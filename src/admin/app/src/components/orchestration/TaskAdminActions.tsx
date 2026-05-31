import { useEffect, useState } from 'react';
import type { Task } from '@/types/orchestration';
import { getRootTaskId } from './taskStatusHelpers';
import { isRootOrchestrationTask } from './TaskLabelsField';

interface TaskAdminActionsProps {
  task: Task;
  agents: { id: string; name: string }[];
  fetchSubtasks: (taskId: string) => Promise<Task[]>;
  delegateTeam: (taskId: string, options?: { supersede?: boolean; managerId?: string }) => Promise<void>;
  refreshTaskContext: (taskId: string) => Promise<void>;
  refreshRootContext: (rootTaskId: string) => Promise<void>;
  requestClarification: (taskId: string, question: string) => Promise<void>;
  addComment: (taskId: string, content: string) => Promise<void>;
  onSubtaskClick?: (task: Task) => void;
  onTasksChanged?: () => void;
}

export function TaskAdminActions({
  task,
  agents,
  fetchSubtasks,
  delegateTeam,
  refreshTaskContext,
  refreshRootContext,
  requestClarification,
  addComment,
  onSubtaskClick,
  onTasksChanged,
}: TaskAdminActionsProps) {
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [supersede, setSupersede] = useState(false);
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const [commentText, setCommentText] = useState('');

  const rootId = getRootTaskId(task);
  const isRoot = isRootOrchestrationTask(task);

  useEffect(() => {
    void (async () => {
      try {
        setSubtasks(await fetchSubtasks(task.id));
      } catch {
        setSubtasks([]);
      }
    })();
  }, [task.id, fetchSubtasks]);

  const runAction = async (label: string, fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await fn();
      setSuccess(label);
      onTasksChanged?.();
      if (label.includes('Delegate')) {
        setSubtasks(await fetchSubtasks(task.id));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-gray-700">
      <h4 className="text-xs font-medium text-gray-400">Admin actions</h4>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}

      {subtasks.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1">Subtasks ({subtasks.length})</p>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {subtasks.map((st) => (
              <li key={st.id}>
                <button
                  type="button"
                  onClick={() => onSubtaskClick?.(st)}
                  className="w-full text-left px-2 py-1 rounded bg-gray-900/60 border border-gray-700 hover:border-gray-600 text-xs"
                >
                  <span className="text-gray-300">{st.title}</span>
                  <span className="text-gray-500 ml-2">{st.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() =>
            void runAction('Context refreshed for this task', () => refreshTaskContext(task.id))
          }
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs disabled:opacity-50"
        >
          Refresh context
        </button>
        {isRoot && (
          <button
            type="button"
            disabled={loading}
            onClick={() =>
              void runAction('Context refreshed for epic', () => refreshRootContext(rootId))
            }
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs disabled:opacity-50"
          >
            Refresh epic context
          </button>
        )}
      </div>

      {isRoot && task.assigneeId && (
        <div className="space-y-2 p-2 rounded border border-gray-700 bg-gray-900/40">
          <p className="text-xs text-gray-500">Re-run team delegation</p>
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={supersede}
              onChange={(e) => setSupersede(e.target.checked)}
              className="rounded border-gray-600"
            />
            Supersede overlapping open subtasks (pipeline-mode only)
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() =>
              void runAction('Delegation triggered', () =>
                delegateTeam(task.id, { supersede, managerId: task.assigneeId }),
              )
            }
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-xs disabled:opacity-50"
          >
            Delegate team
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs text-gray-500">Request user clarification</label>
        <textarea
          value={clarifyQuestion}
          onChange={(e) => setClarifyQuestion(e.target.value)}
          placeholder="Question for the human board..."
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-xs min-h-[50px]"
        />
        <button
          type="button"
          disabled={loading || !clarifyQuestion.trim()}
          onClick={() =>
            void runAction('Clarification requested', async () => {
              await requestClarification(task.id, clarifyQuestion.trim());
              setClarifyQuestion('');
            })
          }
          className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 rounded text-xs disabled:opacity-50"
        >
          Send clarification
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-gray-500">Add comment</label>
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Admin note..."
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-xs min-h-[40px]"
        />
        <button
          type="button"
          disabled={loading || !commentText.trim()}
          onClick={() =>
            void runAction('Comment added', async () => {
              await addComment(task.id, commentText.trim());
              setCommentText('');
            })
          }
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs disabled:opacity-50"
        >
          Post comment
        </button>
      </div>

      <p className="text-[10px] text-gray-600">
        Manager: {agents.find((a) => a.id === task.assigneeId)?.name ?? task.assigneeId ?? '—'}
      </p>
    </div>
  );
}
