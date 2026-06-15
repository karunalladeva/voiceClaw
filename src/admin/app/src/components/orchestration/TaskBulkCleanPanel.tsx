import { useMemo, useState } from 'react';
import type { Task, TaskStatus } from '@/types/orchestration';

const ALL_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
];

const ACTIVE_STATUSES: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'review',
];

interface TaskBulkCleanPanelProps {
  tasks: Task[];
  onBulkUpdateStatus: (options: {
    status: TaskStatus;
    fromStatuses?: TaskStatus[];
  }) => Promise<{ count: number }>;
  onDone?: () => void;
}

export function TaskBulkCleanPanel({
  tasks,
  onBulkUpdateStatus,
  onDone,
}: TaskBulkCleanPanelProps) {
  const [open, setOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<TaskStatus>('cancelled');
  const [scope, setScope] = useState<'active' | 'all' | 'custom'>('active');
  const [customFrom, setCustomFrom] = useState<TaskStatus[]>([...ACTIVE_STATUSES]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fromStatuses = useMemo((): TaskStatus[] | undefined => {
    if (scope === 'all') return undefined;
    if (scope === 'active') return ACTIVE_STATUSES;
    return customFrom;
  }, [scope, customFrom]);

  const matchCount = useMemo(() => {
    return tasks.filter((task) => {
      if (task.status === targetStatus) return false;
      if (fromStatuses && !fromStatuses.includes(task.status)) return false;
      return true;
    }).length;
  }, [tasks, targetStatus, fromStatuses]);

  const toggleCustomStatus = (status: TaskStatus) => {
    setCustomFrom((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  };

  const runBulkUpdate = async () => {
    if (matchCount === 0) return;
    const label = `Move ${matchCount} task(s) to "${targetStatus}"?`;
    if (!window.confirm(label)) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await onBulkUpdateStatus({
        status: targetStatus,
        fromStatuses: scope === 'all' ? undefined : fromStatuses,
      });
      setSuccess(`Updated ${result.count} task(s) to ${targetStatus}.`);
      onDone?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk update failed');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md text-xs font-medium transition-colors border border-gray-600"
      >
        Clean tasks…
      </button>
    );
  }

  return (
    <div className="p-4 bg-gray-900/60 rounded-lg border border-amber-800/50 shrink-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-amber-200">Bulk task cleanup</h4>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          Close
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Move multiple tasks to a new status. Use this to clear the board or cancel stuck work.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Move to status</label>
          <select
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value as TaskStatus)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm"
          >
            {ALL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-xs text-gray-400">Include tasks currently in</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'active' | 'all' | 'custom')}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm"
          >
            <option value="active">Active only (not done / cancelled)</option>
            <option value="all">All statuses (except already at target)</option>
            <option value="custom">Pick source statuses…</option>
          </select>
        </div>
      </div>
      {scope === 'custom' && (
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map((status) => (
            <label
              key={status}
              className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={customFrom.includes(status)}
                onChange={() => toggleCustomStatus(status)}
                className="rounded border-gray-600"
              />
              {status}
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-400">
          <span className="text-white font-medium">{matchCount}</span> task(s) will be updated
        </p>
        <button
          type="button"
          disabled={loading || matchCount === 0}
          onClick={() => void runBulkUpdate()}
          className="px-4 py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white rounded-md text-xs font-medium"
        >
          {loading ? 'Updating…' : `Move ${matchCount} task(s)`}
        </button>
      </div>
    </div>
  );
}
