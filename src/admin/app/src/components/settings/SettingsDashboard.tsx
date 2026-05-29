import { useState } from 'react'
import { cn } from '@/lib/utils'
import { GeneralSettingsForm, type SettingsTab } from './GeneralSettingsForm'
import { ModelsPanel } from './ModelsPanel'
import { MemoryPanel } from './MemoryPanel'
import { SkillsPanel } from './SkillsPanel'
import { WorkspacePanel } from './WorkspacePanel'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' },
  { id: 'memory', label: 'Memory' },
  { id: 'skills', label: 'Skills' },
  { id: 'workspace', label: 'Workspace' },
]

export function SettingsDashboard() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  return (
    <div>
      <div className="flex items-center gap-1 mb-6 border-b border-border pb-0">
        {TABS.map((tab) => (
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

      {activeTab === 'general' && <GeneralSettingsForm onNavigate={setActiveTab} />}
      {activeTab === 'models' && <ModelsPanel />}
      {activeTab === 'memory' && <MemoryPanel />}
      {activeTab === 'skills' && <SkillsPanel />}
      {activeTab === 'workspace' && <WorkspacePanel />}
    </div>
  )
}
