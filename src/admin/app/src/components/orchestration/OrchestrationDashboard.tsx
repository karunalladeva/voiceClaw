import { useState } from 'react';
import { CompanySelector } from './CompanySelector';
import { OrgChart } from './OrgChart';
import { TaskBoard } from './TaskBoard';
import { ApprovalsPanel } from './ApprovalsPanel';
import { BudgetDashboard } from './BudgetDashboard';
import { ActivityLog } from './ActivityLog';
import { RoutineList } from './RoutineList';
import { TradingDashboard } from './TradingDashboard';
import { CreatorDashboard } from './CreatorDashboard';
import {
  useCompanies,
  useOrgAgents,
  useTasks,
  useApprovals,
  useActivity,
  useBudget,
  useRoutines,
} from '@/hooks/useOrchestration';
import { useOrchestrationLive } from '@/hooks/useOrchestrationLive';
import type { Company } from '@/types/orchestration';
import { MarkdownField } from './MarkdownField';
import { CompanySettingsPanel } from './CompanyPipelineSettings';

type Tab = 'overview' | 'tasks' | 'routines' | 'creator' | 'org' | 'budget' | 'activity' | 'trading';

export function OrchestrationDashboard() {
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyMission, setNewCompanyMission] = useState('');
  const liveRevision = useOrchestrationLive();

  const { companies, createCompany, updateCompanySettings } = useCompanies(liveRevision);
  const { agents, createAgent, updateAgent, triggerHeartbeat } = useOrgAgents(selectedCompany?.id, liveRevision);
  const { tasks, createTask, updateTask, reviewTask, fetchWorkProducts, fetchComments, fetchSubtasks, delegateTeam, refreshTaskContext, refreshRootContext, requestClarification, addTaskComment, refresh: refreshTasks } = useTasks(
    selectedCompany?.id,
    liveRevision,
  );
  const { approvals, approve, reject, respondClarification } = useApprovals(
    selectedCompany?.id,
    liveRevision,
  );
  const { activity } = useActivity(selectedCompany?.id, liveRevision);
  const { spending, requestBudget } = useBudget(selectedCompany?.id || '', liveRevision);
  const { routines, createRoutine, toggleRoutine, deleteRoutine } = useRoutines(selectedCompany?.id, liveRevision);

  const handleCreateCompany = async () => {
    if (newCompanyName && newCompanyMission) {
      const result = await createCompany(newCompanyName, newCompanyMission);
      if (result.company) {
        setSelectedCompany(result.company);
        setShowCreateCompany(false);
        setNewCompanyName('');
        setNewCompanyMission('');
      }
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'routines', label: 'Routines' },
    { id: 'trading', label: 'Trading' },
    { id: 'creator', label: 'Creator' },
    { id: 'org', label: 'Organization' },
    { id: 'budget', label: 'Budget' },
    { id: 'activity', label: 'Activity' },
  ];

  if (companies.length === 0 && !showCreateCompany) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
        <div className="max-w-md space-y-2">
          <h2 className="text-2xl font-bold text-gray-200">Welcome to Orchestration</h2>
          <p className="text-gray-400">
            Get started by creating your first company. You'll be able to add agents,
            assign tasks, and manage budgets within your organization.
          </p>
        </div>
        <button
          onClick={() => setShowCreateCompany(true)}
          className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-green-600/20"
        >
          Create First Company
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-xl font-bold">Orchestration</h2>
        <CompanySelector
          companies={companies}
          selectedId={selectedCompany?.id}
          onSelect={setSelectedCompany}
          onCreate={() => setShowCreateCompany(true)}
        />
      </div>

      {showCreateCompany && (
        <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <h3 className="font-semibold mb-4 text-lg">Create New Company</h3>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-400">Company Name</label>
              <input
                type="text"
                placeholder="Acme Corp"
                value={newCompanyName}
                onChange={e => setNewCompanyName(e.target.value)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-500 focus:border-green-500 transition-all"
              />
            </div>
            <MarkdownField
              label="Company Mission"
              value={newCompanyMission}
              onChange={setNewCompanyMission}
              placeholder={'## Mission\nBuild the best AI agents for…'}
              minRows={5}
              accent="green"
            />
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCreateCompany}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-md text-sm font-medium transition-colors"
              >
                Create Company
              </button>
              {companies.length > 0 && (
                <button
                  onClick={() => setShowCreateCompany(false)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-sm font-medium transition-colors text-gray-300"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedCompany && (
        <>
          <div className="flex border-b border-gray-700 shrink-0 mt-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 -mb-px text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'text-green-400 border-green-400 bg-gray-800/30'
                    : 'text-gray-400 border-transparent hover:text-gray-300 hover:border-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 pt-2 pb-6">
            {activeTab === 'overview' && (
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-4">
                <div className="grid grid-cols-4 gap-4">
                  <StatBox label="Agents" value={agents.length} />
                  <StatBox label="Active" value={agents.filter(a => a.status === 'active').length} />
                  <StatBox label="Tasks" value={tasks.filter(t => t.status !== 'done').length} />
                  <StatBox label="In Progress" value={tasks.filter(t => t.status === 'in_progress').length} />
                </div>
                <BudgetDashboard agents={agents} spending={spending} />
              </div>
              <div className="space-y-4">
                <CompanySettingsPanel
                  company={selectedCompany}
                  onUpdate={async (companyId, settings) => {
                    await updateCompanySettings(companyId, settings);
                    setSelectedCompany((prev) =>
                      prev && prev.id === companyId
                        ? { ...prev, settings: { ...prev.settings, ...settings } }
                        : prev,
                    );
                  }}
                />
                <ApprovalsPanel
                  approvals={approvals}
                  onApprove={approve}
                  onReject={reject}
                  onClarificationResponse={respondClarification}
                />
                <ActivityLog activity={activity.slice(0, 10)} />
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <TaskBoard
              tasks={tasks}
              agents={agents}
              companyId={selectedCompany.id}
              onCreateTask={createTask}
              onUpdateTask={updateTask}
              onRunNow={triggerHeartbeat}
              onReview={async (taskId, payload) => {
                await reviewTask(taskId, payload);
              }}
              fetchWorkProducts={fetchWorkProducts}
              fetchComments={fetchComments}
              fetchSubtasks={fetchSubtasks}
              delegateTeam={delegateTeam}
              refreshTaskContext={refreshTaskContext}
              refreshRootContext={refreshRootContext}
              requestClarification={requestClarification}
              addTaskComment={addTaskComment}
              onTasksRefresh={() => void refreshTasks()}
            />
          )}

          {activeTab === 'routines' && (
            <RoutineList routines={routines} agents={agents} companyId={selectedCompany.id} onCreateRoutine={createRoutine} onToggleRoutine={toggleRoutine} onDeleteRoutine={deleteRoutine} />
          )}

          {activeTab === 'trading' && (
            <TradingDashboard />
          )}

          {activeTab === 'creator' && (
            <CreatorDashboard />
          )}

          {activeTab === 'org' && (
            <OrgChart
              agents={agents}
              companyId={selectedCompany.id}
              onCreateAgent={createAgent}
              onEditAgent={updateAgent}
              onWakeAgent={triggerHeartbeat}
              liveRevision={liveRevision}
            />
          )}

          {activeTab === 'budget' && (
            <BudgetDashboard agents={agents} spending={spending} onRequestBudget={requestBudget} />
          )}

          {activeTab === 'activity' && (
            <ActivityLog activity={activity} />
          )}
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
