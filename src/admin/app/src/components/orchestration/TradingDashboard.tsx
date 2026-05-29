import { useMemo, useState } from 'react';
import { useTradingAdmin } from '@/hooks/useOrchestration';

function parseSymbols(input: string): string[] {
  return input
    .split(',')
    .map((item: string) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function TradingDashboard() {
  const { templates, runs, skills, loading, runTemplate } = useTradingAdmin();
  const [symbolsInput, setSymbolsInput] = useState('AMD,NVDA,GOOGL,AMZN,MSFT,META,AAPL,TSLA,NFLX,CRM');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runMessage, setRunMessage] = useState('');
  const grouped = useMemo(() => {
    const map = new Map<string, typeof templates>();
    for (const template of templates) {
      const current = map.get(template.category) || [];
      current.push(template);
      map.set(template.category, current);
    }
    return Array.from(map.entries());
  }, [templates]);

  const executeTemplate = async () => {
    if (!selectedTemplate) return;
    setIsRunning(true);
    setRunMessage('Running template...');
    try {
      const symbols = parseSymbols(symbolsInput);
      const response = await runTemplate(selectedTemplate, symbols);
      if (!response?.success) {
        setRunMessage(response?.error || 'Template run failed.');
        return;
      }
      const stepCount = Array.isArray(response?.run?.outputs) ? response.run.outputs.length : 0;
      setRunMessage(`Template completed (${stepCount} steps).`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Template run failed.';
      setRunMessage(message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700 space-y-3">
        <h3 className="text-lg font-semibold">Trading Run Console</h3>
        <p className="text-sm text-gray-400">
          Select a trading template and execute it against a comma-separated symbol list.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">Template</label>
            <select
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
            >
              <option value="">Select template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">Symbols</label>
            <input
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm"
              value={symbolsInput}
              onChange={(e) => setSymbolsInput(e.target.value)}
              placeholder="AAPL,MSFT,NVDA"
            />
          </div>
        </div>
        <button
          onClick={executeTemplate}
          disabled={isRunning || !selectedTemplate}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-md text-sm font-medium"
        >
          {isRunning ? 'Running...' : 'Run Trading Template'}
        </button>
        {runMessage && <p className="text-xs text-yellow-300">{runMessage}</p>}
      </div>

      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <h4 className="font-semibold mb-3">Template Library</h4>
        {loading && <p className="text-sm text-gray-400">Loading templates...</p>}
        {!loading && grouped.length === 0 && (
          <p className="text-sm text-gray-400">No templates found in top-level template folder.</p>
        )}
        <div className="space-y-3">
          {grouped.map(([category, items]) => (
            <div key={category}>
              <p className="text-xs uppercase tracking-wide text-green-400 mb-1">{category}</p>
              <div className="grid grid-cols-2 gap-2">
                {items.map((item) => (
                  <div key={item.id} className="p-2 rounded border border-gray-700 bg-gray-900/50">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{item.description || 'No description'}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <h4 className="font-semibold mb-3">Loaded Trading Skills ({skills.length})</h4>
        <div className="grid grid-cols-3 gap-2 mb-4 max-h-56 overflow-auto">
          {skills.map((skill) => (
            <div key={skill.id} className="p-2 rounded border border-gray-700 bg-gray-900/50">
              <p className="text-xs font-semibold text-green-300">{skill.name}</p>
              <p className="text-[11px] text-gray-400">{skill.category}</p>
            </div>
          ))}
          {skills.length === 0 && <p className="text-sm text-gray-400">No trading skills discovered.</p>}
        </div>
      </div>

      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <h4 className="font-semibold mb-3">Recent Trading Runs</h4>
        <div className="space-y-2 max-h-72 overflow-auto">
          {runs.map((run) => (
            <div key={`${run.pipelineId}-${run.ranAt}`} className="p-3 rounded border border-gray-700 bg-gray-900/50">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{run.pipelineName}</p>
                <span className={`text-xs ${run.success ? 'text-green-400' : 'text-red-400'}`}>
                  {run.success ? 'SUCCESS' : 'FAILED'}
                </span>
              </div>
              <p className="text-xs text-gray-400">{new Date(run.ranAt).toLocaleString()}</p>
            </div>
          ))}
          {runs.length === 0 && <p className="text-sm text-gray-400">No runs yet.</p>}
        </div>
      </div>
    </div>
  );
}

