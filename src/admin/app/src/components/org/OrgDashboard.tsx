import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Building2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { ApprovalRequestList } from '@/components/orchestration/ApprovalRequestList';
import {
  useCompanies,
  useOrgAgents,
  useApprovals,
  useAgentRuns,
} from '@/hooks/useOrchestration';
import { useOrchestrationLive } from '@/hooks/useOrchestrationLive';
import type { ApprovalRequest, Company, OrgAgent } from '@/types/orchestration';

const ALL_AGENTS = '';

function formatRunDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function OrgDashboard() {
  const liveRevision = useOrchestrationLive();
  const { companies, loading: companiesLoading } = useCompanies(liveRevision);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState(ALL_AGENTS);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompany && companies.length > 0) {
      setSelectedCompany(companies[0]);
    }
  }, [companies, selectedCompany]);

  const companyId = selectedCompany?.id;
  const { agents, loading: agentsLoading } = useOrgAgents(companyId, liveRevision);
  const { approvals, approve, reject, respondClarification } = useApprovals(
    companyId,
    liveRevision,
  );
  const agentFilter = selectedAgentId || undefined;
  const { runs, loading: runsLoading, refresh: refreshRuns } = useAgentRuns(
    companyId,
    agentFilter,
    liveRevision,
  );

  const agentMap = useMemo(() => {
    const map = new Map<string, OrgAgent>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const filteredApprovals = useMemo(() => {
    if (!selectedAgentId) return approvals;
    return approvals.filter((a) => a.requesterId === selectedAgentId);
  }, [approvals, selectedAgentId]);

  const resolveRequesterName = (approval: ApprovalRequest): string => {
    if (approval.requesterType === 'human') return 'User';
    return agentMap.get(approval.requesterId)?.name ?? approval.requesterId;
  };

  const handleRefresh = () => {
    void refreshRuns();
  };

  if (companiesLoading) {
    return (
      <div className="w-full max-w-3xl mx-auto text-center py-16 text-muted-foreground">
        Loading organization…
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="w-full max-w-3xl mx-auto text-center py-16">
        <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="font-medium">No companies yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create a company in Admin → Orchestration first.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto pb-8">
      <div className="flex flex-col sm:flex-row items-center justify-between mb-4 gap-4">
        <div className="text-center flex-1 min-w-0">
          <h2 className="text-lg font-semibold">Organization</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pending approvals and agent process logs (prompt + answer).
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <label className="flex-1 space-y-1">
          <span className="text-xs text-muted-foreground">Company</span>
          <select
            value={selectedCompany?.id ?? ''}
            onChange={(e) => {
              const c = companies.find((x) => x.id === e.target.value);
              setSelectedCompany(c ?? null);
              setSelectedAgentId(ALL_AGENTS);
            }}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 space-y-1">
          <span className="text-xs text-muted-foreground">Employee</span>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            disabled={agentsLoading || !companyId}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background disabled:opacity-50"
          >
            <option value={ALL_AGENTS}>All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.title})
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Pending approvals</h3>
          {filteredApprovals.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-600 dark:text-orange-400 font-medium">
              {filteredApprovals.length}
            </span>
          )}
        </div>
        {filteredApprovals.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No pending approvals
            {selectedAgentId ? ' for this agent' : ''}.
          </Card>
        ) : (
          <ApprovalRequestList
            variant="chat"
            approvals={filteredApprovals}
            onApprove={(id) => void approve(id)}
            onReject={(id) => void reject(id)}
            onClarificationResponse={(id, response) => void respondClarification(id, response)}
            requesterName={resolveRequesterName}
          />
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">Agent process logs</h3>
        {runsLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading runs…
          </div>
        ) : runs.length === 0 ? (
          <Card className="p-10 text-center">
            <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No agent runs yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Trigger a heartbeat or wait for scheduled work to see prompt and answer logs.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {runs.map((run) => {
              const isOpen = expandedRunId === run.id;
              return (
                <Card key={run.id} className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedRunId(isOpen ? null : run.id)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/50 transition-colors"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    {run.success ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">
                        {run.agentName}
                        {run.taskTitle ? ` · ${run.taskTitle}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        <span className="font-mono text-primary">{run.mode}</span>
                        <span>{formatRunDate(run.createdAt)}</span>
                        <span>{formatDuration(run.durationMs)}</span>
                        <span className="font-mono">{run.modelId}</span>
                      </div>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-border space-y-4">
                      {run.error && (
                        <p className="text-xs text-destructive mt-3">{run.error}</p>
                      )}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Prompt</p>
                        <div className="text-xs rounded-md border border-border bg-secondary/30 p-3 max-h-64 overflow-y-auto">
                          <ChatMarkdown content={run.prompt} className="text-xs" />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Answer</p>
                        <div className="text-xs rounded-md border border-border bg-secondary/30 p-3 max-h-64 overflow-y-auto">
                          <ChatMarkdown
                            content={run.answer || '_No output_'}
                            className="text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
