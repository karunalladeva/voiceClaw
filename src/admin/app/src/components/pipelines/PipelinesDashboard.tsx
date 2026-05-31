import { useState } from 'react'
import {
  RefreshCw,
  Sparkles,
  History,
  Play,
  Pause,
  Trash2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  MoreVertical,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { usePipelines } from '@/hooks/useApi'
import { SettingsToast } from '@/components/settings/SettingsControls'

type PipelineTab = 'active' | 'history'

function formatPipelineDate(ms?: number): string {
  if (!ms) return 'N/A'
  const d = new Date(ms)
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatStepChain(steps: { type: string }[]): string {
  return steps.map((s) => s.type).join(' → ')
}

export function PipelinesDashboard() {
  const {
    pipelines,
    history,
    loading,
    error,
    runningId,
    fetchPipelines,
    deletePipeline,
    togglePipeline,
    runPipeline,
  } = usePipelines()

  const [activeTab, setActiveTab] = useState<PipelineTab>('active')
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant })
  }

  const handleRun = async (id: string) => {
    setOpenMenuId(null)
    try {
      await runPipeline(id)
      showToast('Pipeline executed!')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Run failed', 'error')
    }
  }

  const handleToggle = async (id: string) => {
    setOpenMenuId(null)
    try {
      await togglePipeline(id)
      showToast('Pipeline updated')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Toggle failed', 'error')
    }
  }

  const handleDelete = async (id: string, name: string) => {
    setOpenMenuId(null)
    if (!confirm(`Delete pipeline "${name}"?`)) return
    try {
      await deletePipeline(id)
      showToast('Pipeline deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-3xl mx-auto text-center py-16 text-muted-foreground">
        Loading pipelines...
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-4 gap-4">
        <div className="text-center flex-1 min-w-0">
          <h2 className="text-lg font-semibold">Pipelines &amp; Jobs</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Scheduled and manual automation jobs, same as the mobile app.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchPipelines}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      <div className="flex items-center justify-center gap-1 mb-6 border-b border-border">
        {([
          { id: 'active' as const, label: 'Active Pipelines' },
          { id: 'history' as const, label: 'Job History' },
        ]).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'active' && (
        <>
          {pipelines.length === 0 ? (
            <Card className="p-10 text-center">
              <Sparkles className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No pipelines yet</p>
              <p className="text-sm text-muted-foreground mt-1">Ask the AI to create one in chat!</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {pipelines.map((pipeline) => {
                const enabled = pipeline.enabled
                const isRunning = runningId === pipeline.id
                return (
                  <Card key={pipeline.id} className="p-4">
                    <div className="flex items-start gap-3">
                      {enabled ? (
                        <Play className="w-5 h-5 text-success shrink-0 mt-0.5" />
                      ) : (
                        <Pause className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-semibold truncate">{pipeline.name}</h3>
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenMenuId(openMenuId === pipeline.id ? null : pipeline.id)
                              }
                              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                              aria-label="Pipeline actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openMenuId === pipeline.id && (
                              <>
                                <div
                                  className="fixed inset-0 z-10"
                                  onClick={() => setOpenMenuId(null)}
                                />
                                <div className="absolute right-0 top-8 z-20 min-w-[140px] rounded-md border border-border bg-card shadow-lg py-1">
                                  <button
                                    type="button"
                                    disabled={isRunning}
                                    onClick={() => handleRun(pipeline.id)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50"
                                  >
                                    {isRunning ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Play className="w-4 h-4 text-primary" />
                                    )}
                                    Run now
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggle(pipeline.id)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary"
                                  >
                                    {enabled ? (
                                      <Pause className="w-4 h-4" />
                                    ) : (
                                      <Play className="w-4 h-4" />
                                    )}
                                    {enabled ? 'Disable' : 'Enable'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(pipeline.id, pipeline.name)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    Delete
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        <p className="text-xs font-mono text-primary mt-2 break-words">
                          {formatStepChain(pipeline.steps)}
                        </p>
                        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {pipeline.schedule || 'Manual'}
                          </span>
                          <span>Next: {formatPipelineDate(pipeline.nextRun)}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      {activeTab === 'history' && (
        <>
          {history.length === 0 ? (
            <Card className="p-10 text-center">
              <History className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No job history yet</p>
              <p className="text-sm text-muted-foreground mt-1">Run a pipeline to see results here.</p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((entry, index) => {
                const key = `${entry.pipelineId}-${entry.ranAt}-${index}`
                const isOpen = expandedHistory === key
                return (
                  <Card key={key} className="overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedHistory(isOpen ? null : key)}
                      className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/50 transition-colors"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                      {entry.success ? (
                        <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-destructive shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate">{entry.pipelineName}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatPipelineDate(entry.ranAt)}
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 border-t border-border">
                        <div className="mt-3 space-y-2">
                          {entry.stepResults.map((step, stepIndex) => (
                            <div
                              key={`${step.type}-${stepIndex}`}
                              className="text-sm flex items-start gap-2"
                            >
                              <span>{step.success ? '✅' : '❌'}</span>
                              <div className="min-w-0">
                                <span className="font-mono text-xs text-primary">{step.type}</span>
                                {step.output && (
                                  <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">
                                    {step.output.length > 300
                                      ? `${step.output.slice(0, 300)}…`
                                      : step.output}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      {toast && (
        <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />
      )}
    </div>
  )
}
