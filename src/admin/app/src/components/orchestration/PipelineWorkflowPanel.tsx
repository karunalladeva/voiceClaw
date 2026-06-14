import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { PipelineWorkflowInfo, Task } from '@/types/orchestration';
import { PIPELINE_MODE_LABEL } from '@/types/orchestration';

interface Props {
  task: Task;
  tasks: Task[];
  fetchPipelineWorkflow: (taskId: string) => Promise<PipelineWorkflowInfo>;
  onSelectTask?: (task: Task) => void;
}

function statusColor(status: string | null): string {
  switch (status) {
    case 'done':
      return 'bg-green-900/40 text-green-300 border-green-800';
    case 'in_progress':
      return 'bg-blue-900/40 text-blue-300 border-blue-800';
    case 'blocked':
      return 'bg-orange-900/40 text-orange-300 border-orange-800';
    case 'review':
      return 'bg-purple-900/40 text-purple-300 border-purple-800';
    default:
      return 'bg-gray-800 text-gray-400 border-gray-700';
  }
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(path).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-left font-mono text-xs text-cyan-400/90 break-all hover:text-cyan-300"
      title="Copy path"
    >
      {path}
      {copied && <span className="ml-2 text-green-400">copied</span>}
    </button>
  );
}

export function PipelineWorkflowPanel({
  task,
  tasks,
  fetchPipelineWorkflow,
  onSelectTask,
}: Props) {
  const rootId = task.rootTaskId ?? task.id;
  const root = tasks.find((t) => t.id === rootId);
  const isPipeline = root?.labels?.includes(PIPELINE_MODE_LABEL) ?? task.labels?.includes(PIPELINE_MODE_LABEL);

  const [info, setInfo] = useState<PipelineWorkflowInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  const load = useCallback(async () => {
    if (!isPipeline) return;
    setLoading(true);
    setError(null);
    try {
      setInfo(await fetchPipelineWorkflow(task.id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load pipeline workflow');
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [fetchPipelineWorkflow, isPipeline, task.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isPipeline) return null;

  return (
    <div className="space-y-3 pt-2 border-t border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-gray-400">Pipeline workflow</h4>
        <div className="flex items-center gap-2">
          {info?.workflow ? (
            <Badge className="text-[10px] bg-emerald-900/40 text-emerald-300 border-emerald-800">
              v{info.workflow.version}
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-amber-900/40 text-amber-300 border-amber-800">
              not written
            </Badge>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-[10px] text-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {!error && info && (
        <>
          {info.managerArtifactRelPath && (
            <div>
              <p className="text-[10px] text-gray-500 mb-1">Manager artifact folder</p>
              <CopyPath path={info.managerArtifactRelPath} />
            </div>
          )}

          {info.workflowRelPath && (
            <div>
              <p className="text-[10px] text-gray-500 mb-1">workflow.json</p>
              <CopyPath path={info.workflowRelPath} />
            </div>
          )}

          {!info.workflow && (
            <p className="text-xs text-amber-400/90">
              Manager has not written <code className="text-[10px]">pipeline/workflow.json</code> yet.
              Delegation and skills are blocked until it exists.
            </p>
          )}

          {info.userDecision && (
            <div className="p-2 rounded border border-cyan-900/50 bg-cyan-950/20">
              <p className="text-[10px] font-medium text-cyan-400 mb-1">User decision (binding)</p>
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{info.userDecision.decision}</p>
              {info.userDecisionRelPath && (
                <p className="text-[10px] text-gray-500 mt-1 font-mono">{info.userDecisionRelPath}</p>
              )}
            </div>
          )}

          {info.phases.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 mb-2">Phases</p>
              <div className="space-y-2">
                {info.phases.map((phase) => {
                  const linkedTask = phase.taskId
                    ? tasks.find((t) => t.id === phase.taskId)
                    : undefined;
                  return (
                    <div
                      key={phase.id}
                      className="p-2 rounded border border-gray-700 bg-gray-900/50 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-medium text-gray-200">{phase.title}</span>
                        {phase.taskStatus && (
                          <Badge className={`text-[10px] ${statusColor(phase.taskStatus)}`}>
                            {phase.taskStatus.replace('_', ' ')}
                          </Badge>
                        )}
                        {!phase.taskId && info.workflow && (
                          <Badge className="text-[10px] bg-gray-800 text-gray-500">no subtask</Badge>
                        )}
                      </div>
                      {phase.blockedAfter && (
                        <p className="text-[10px] text-gray-500">
                          After: <span className="text-gray-400">{phase.blockedAfter}</span>
                        </p>
                      )}
                      {phase.blockerTasks && phase.blockerTasks.length > 0 && (
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          Blockers:{' '}
                          {phase.blockerTasks.map((b, i) => (
                            <span key={b.id}>
                              {i > 0 ? ', ' : ''}
                              {b.title} ({b.status})
                            </span>
                          ))}
                        </p>
                      )}
                      {phase.artifactRelPath && (
                        <p className="text-[10px] font-mono text-cyan-400/80 mt-1 break-all">
                          {phase.artifactRelPath}
                        </p>
                      )}
                      {linkedTask && onSelectTask && (
                        <button
                          type="button"
                          onClick={() => onSelectTask(linkedTask)}
                          className="mt-1 text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          Open subtask →
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {info.workflow && (
            <div>
              <button
                type="button"
                onClick={() => setShowJson((v) => !v)}
                className="text-[10px] text-gray-500 hover:text-gray-300"
              >
                {showJson ? 'Hide' : 'Show'} workflow JSON
              </button>
              {showJson && (
                <pre className="mt-2 p-2 max-h-64 overflow-auto rounded border border-gray-700 bg-gray-950 text-[10px] text-gray-400 font-mono">
                  {JSON.stringify(info.workflow, null, 2)}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
