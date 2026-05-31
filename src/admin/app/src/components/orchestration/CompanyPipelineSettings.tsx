import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Company, CompanySettings } from '@/types/orchestration';

interface Props {
  company: Company;
  onUpdate: (companyId: string, settings: Partial<CompanySettings>) => Promise<void>;
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 rounded border-gray-600"
      />
      <span>
        <span className="font-medium text-gray-200">{label}</span>
        <span className="block text-gray-500 mt-0.5">{description}</span>
      </span>
    </label>
  );
}

export function CompanySettingsPanel({ company, onUpdate }: Props) {
  const [settings, setSettings] = useState(company.settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(company.settings);
  }, [company]);

  const patch = async (partial: Partial<CompanySettings>) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onUpdate(company.id, partial);
      setSettings((prev) => ({ ...prev, ...partial }));
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-gray-800/80 border-gray-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Company settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <ToggleRow
          label="Split chapter drafting subtasks"
          description="Requires pipeline-mode on root. Replaces multi-chapter engineering tasks with one subtask per chapter (sequential blockedBy)."
          checked={settings.splitChapterSubtasks ?? false}
          disabled={saving}
          onChange={() =>
            void patch({ splitChapterSubtasks: !(settings.splitChapterSubtasks ?? false) })
          }
        />
        <ToggleRow
          label="Auto-release pipeline subtasks"
          description="Requires root label pipeline-mode. Skips manual review for worker leaf subtasks."
          checked={settings.autoReleasePipelineSubtasks ?? false}
          disabled={saving}
          onChange={() =>
            void patch({ autoReleasePipelineSubtasks: !(settings.autoReleasePipelineSubtasks ?? false) })
          }
        />
        <ToggleRow
          label="Require approval for high-priority tasks"
          description="Critical/high tasks go to approval queue before agents can work them."
          checked={settings.requireApprovalForHighPriorityTasks}
          disabled={saving}
          onChange={() =>
            void patch({
              requireApprovalForHighPriorityTasks: !settings.requireApprovalForHighPriorityTasks,
            })
          }
        />
        <ToggleRow
          label="Require user approval for critical tasks"
          description="Extra human gate for critical-priority work."
          checked={settings.requireUserApprovalForCriticalTasks ?? false}
          disabled={saving}
          onChange={() =>
            void patch({
              requireUserApprovalForCriticalTasks: !(settings.requireUserApprovalForCriticalTasks ?? false),
            })
          }
        />
        <ToggleRow
          label="Require approval for hires"
          checked={settings.requireApprovalForHires}
          disabled={saving}
          onChange={() =>
            void patch({ requireApprovalForHires: !settings.requireApprovalForHires })
          }
          description="New agents need governance approval."
        />
        <ToggleRow
          label="Require approval for budget increases"
          checked={settings.requireApprovalForBudgetIncrease}
          disabled={saving}
          onChange={() =>
            void patch({
              requireApprovalForBudgetIncrease: !settings.requireApprovalForBudgetIncrease,
            })
          }
          description="Agent budget increase requests need approval."
        />
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label className="text-gray-500 block mb-1">Max rework attempts</label>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.maxReworkAttempts ?? 3}
              disabled={saving}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n)) void patch({ maxReworkAttempts: n });
              }}
              className="w-full px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs"
            />
          </div>
          <div>
            <label className="text-gray-500 block mb-1">Default agent budget (USD)</label>
            <input
              type="number"
              min={0}
              value={settings.defaultAgentBudgetUSD}
              disabled={saving}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n)) void patch({ defaultAgentBudgetUSD: n });
              }}
              className="w-full px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs"
            />
          </div>
        </div>
        {error && <p className="text-red-400">{error}</p>}
        {saved && !error && <p className="text-emerald-400">Saved</p>}
      </CardContent>
    </Card>
  );
}

/** @deprecated use CompanySettingsPanel */
export const CompanyPipelineSettings = CompanySettingsPanel;
