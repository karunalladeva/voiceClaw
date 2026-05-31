import type { Task } from '@/types/orchestration';

interface Props {
  tasks: Task[];
  excludeTaskId?: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}

export function TaskDependencyPicker({
  tasks,
  excludeTaskId,
  selectedIds,
  onChange,
  label = 'Depends on',
}: Props) {
  const candidates = tasks.filter(
    t => t.id !== excludeTaskId && t.status !== 'cancelled',
  );

  const toggle = (taskId: string) => {
    if (selectedIds.includes(taskId)) {
      onChange(selectedIds.filter(id => id !== taskId));
      return;
    }
    onChange([...selectedIds, taskId]);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-gray-400">{label}</label>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] text-gray-500 hover:text-gray-300 underline"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="max-h-32 overflow-y-auto rounded-md border border-gray-700 bg-gray-900/80 p-2 space-y-1">
        {candidates.length === 0 && (
          <p className="text-xs text-gray-500">No other tasks available.</p>
        )}
        {candidates.map(t => (
          <label
            key={t.id}
            className="flex items-start gap-2 text-xs cursor-pointer hover:bg-gray-800/60 rounded px-1 py-0.5"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(t.id)}
              onChange={() => toggle(t.id)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="text-gray-200">{t.title}</span>
              <span className="text-gray-500 ml-1">({t.status})</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
