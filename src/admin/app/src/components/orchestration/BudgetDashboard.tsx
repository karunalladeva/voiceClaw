import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { OrgAgent } from '@/types/orchestration';

interface Props {
  agents: OrgAgent[];
  spending?: {
    totalCostUSD: number;
    byAgent: Record<string, number>;
    byModel: Record<string, number>;
  } | null;
  onRequestBudget?: (agentId: string, newLimit: number, reason: string) => Promise<any>;
}

export function BudgetDashboard({ agents, spending, onRequestBudget }: Props) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [reqAgent, setReqAgent] = useState('');
  const [reqAmount, setReqAmount] = useState('');
  const [reqReason, setReqReason] = useState('');

  const handleRequest = async () => {
    if (reqAgent && reqAmount && reqReason && onRequestBudget) {
      await onRequestBudget(reqAgent, Number(reqAmount), reqReason);
      setIsRequesting(false);
      setReqAgent('');
      setReqAmount('');
      setReqReason('');
    }
  };

  const totalBudget = agents.reduce((sum, a) => sum + a.budget.monthlyLimitUSD, 0);
  const totalSpent = agents.reduce((sum, a) => sum + a.budget.spentThisMonthUSD, 0);
  const usagePercent = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  const agentsOverBudget = agents.filter(
    a => a.budget.spentThisMonthUSD >= a.budget.monthlyLimitUSD * (a.budget.warningThresholdPercent / 100)
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center shrink-0">
        <h3 className="font-semibold text-lg text-white">Budget Overview</h3>
        <button
          onClick={() => setIsRequesting(true)}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-medium transition-colors"
        >
          Request Budget Increase
        </button>
      </div>

      {isRequesting && (
        <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 shrink-0">
          <h4 className="text-sm font-medium mb-3">Request Budget Increase</h4>
          <div className="grid grid-cols-4 gap-4 items-start">
            <div className="col-span-2 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Select Agent</label>
                <select
                  value={reqAgent}
                  onChange={e => setReqAgent(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">Choose an agent...</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name} (Current limit: ${a.budget.monthlyLimitUSD})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">New Monthly Limit ($)</label>
                <input
                  type="number"
                  value={reqAmount}
                  onChange={e => setReqAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="e.g. 100"
                  min="0"
                />
              </div>
            </div>
            
            <div className="col-span-2 space-y-3 flex flex-col h-full justify-between">
              <div className="space-y-1.5 flex-1 flex flex-col">
                <label className="text-xs text-gray-400">Reason</label>
                <textarea
                  value={reqReason}
                  onChange={e => setReqReason(e.target.value)}
                  className="w-full flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500 min-h-[60px] resize-none"
                  placeholder="Why is this increase needed?"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRequest}
                  className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-md text-sm font-medium transition-colors"
                >
                  Submit Request
                </button>
                <button
                  onClick={() => setIsRequesting(false)}
                  className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md text-sm font-medium transition-colors border border-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-gray-400">Total Budget Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 mb-2">
            <span className="text-3xl font-bold">${totalSpent.toFixed(2)}</span>
            <span className="text-gray-500 pb-1">/ ${totalBudget.toFixed(2)}</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
            <div
              className={`h-full transition-all ${
                usagePercent >= 100
                  ? 'bg-red-500'
                  : usagePercent >= 80
                  ? 'bg-yellow-500'
                  : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">{usagePercent.toFixed(1)}% of total budget used this month</p>
        </CardContent>
      </Card>

      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-gray-400">Budget Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {agentsOverBudget.length === 0 ? (
            <p className="text-green-400 text-sm">All agents within budget</p>
          ) : (
            <div className="space-y-2">
              {agentsOverBudget.map(agent => {
                const usage = (agent.budget.spentThisMonthUSD / agent.budget.monthlyLimitUSD) * 100;
                return (
                  <div key={agent.id} className="flex items-center justify-between">
                    <span className="text-sm">{agent.name}</span>
                    <span className={`text-sm ${usage >= 100 ? 'text-red-400' : 'text-yellow-400'}`}>
                      {usage.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {spending && Object.keys(spending.byModel).length > 0 && (
        <Card className="bg-gray-800/50 border-gray-700 col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-400">Spending by Model</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(spending.byModel)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 6)
                .map(([model, cost]) => (
                  <div key={model} className="p-2 bg-gray-900/50 rounded">
                    <p className="text-xs text-gray-400 truncate">{model}</p>
                    <p className="font-medium">${(cost as number).toFixed(4)}</p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
