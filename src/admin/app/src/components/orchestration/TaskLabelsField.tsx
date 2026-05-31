import { useState } from 'react';
import { PIPELINE_MODE_LABEL } from '@/types/orchestration';

interface Props {
  labels: string[];
  onChange: (labels: string[]) => void;
  /** Show pipeline-mode toggle (root tasks only). */
  showPipelineToggle?: boolean;
}

export function TaskLabelsField({ labels, onChange, showPipelineToggle = true }: Props) {
  const [customLabel, setCustomLabel] = useState('');
  const hasPipeline = labels.includes(PIPELINE_MODE_LABEL);

  const togglePipeline = () => {
    if (hasPipeline) {
      onChange(labels.filter((l) => l !== PIPELINE_MODE_LABEL));
    } else {
      onChange([...new Set([...labels, PIPELINE_MODE_LABEL])]);
    }
  };

  const addCustomLabel = () => {
    const trimmed = customLabel.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed || labels.includes(trimmed)) {
      setCustomLabel('');
      return;
    }
    onChange([...labels, trimmed]);
    setCustomLabel('');
  };

  const removeLabel = (label: string) => {
    onChange(labels.filter((l) => l !== label));
  };

  return (
    <div className="space-y-2">
      <label className="text-xs text-gray-400">Labels</label>
      {showPipelineToggle && (
        <label className="flex items-start gap-2 p-2 rounded border border-gray-700 bg-gray-900/40 cursor-pointer">
          <input
            type="checkbox"
            checked={hasPipeline}
            onChange={togglePipeline}
            className="mt-0.5 rounded border-gray-600"
          />
          <span className="text-xs">
            <span className="font-medium text-emerald-400">Pipeline mode</span>
            <span className="block text-gray-500 mt-0.5">
              Enables model pin, coordinator checkout guard, and optional auto-release (with company
              setting). Root task only.
            </span>
          </span>
        </label>
      )}
      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded ${
                label === PIPELINE_MODE_LABEL
                  ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-800'
                  : 'bg-gray-700 text-gray-300'
              }`}
            >
              {label}
              <button
                type="button"
                onClick={() => removeLabel(label)}
                className="text-gray-400 hover:text-gray-200"
                aria-label={`Remove ${label}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustomLabel();
            }
          }}
          placeholder="Custom label..."
          className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={addCustomLabel}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-xs"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function isRootOrchestrationTask(task: { id: string; parentTaskId?: string; rootTaskId?: string }): boolean {
  if (task.parentTaskId) return false;
  return !task.rootTaskId || task.rootTaskId === task.id;
}
