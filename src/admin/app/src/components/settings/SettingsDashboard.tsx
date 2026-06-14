import { useState } from 'react'
import { GeneralSettingsForm } from './GeneralSettingsForm'
import { ModelsPanel } from './ModelsPanel'
import { MemoryPanel } from './MemoryPanel'
import { SkillsPanel } from './SkillsPanel'
import { WorkspacePanel } from './WorkspacePanel'
import { ChannelsPanel } from './ChannelsPanel'
import { ComfyUIPanel } from './ComfyUIPanel'
import { LlamaCppPanel } from './LlamaCppPanel'
import { SearXngPanel } from './SearXngPanel'
import { MicroRouterPanel } from './MicroRouterPanel'
import { SettingsTabNav } from './SettingsTabNav'
import type { SettingsTab } from './settings-tabs'

export function SettingsDashboard() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  return (
    <div>
      <SettingsTabNav activeTab={activeTab} onSelect={setActiveTab} />

      {activeTab === 'general' && <GeneralSettingsForm onNavigate={setActiveTab} />}
      {activeTab === 'models' && <ModelsPanel onNavigate={setActiveTab} />}
      {activeTab === 'memory' && <MemoryPanel />}
      {activeTab === 'skills' && <SkillsPanel />}
      {activeTab === 'channels' && <ChannelsPanel />}
      {activeTab === 'searxng' && <SearXngPanel />}
      {activeTab === 'comfyui' && <ComfyUIPanel />}
      {activeTab === 'llamacpp' && <LlamaCppPanel />}
      {activeTab === 'micro-router' && <MicroRouterPanel />}
      {activeTab === 'workspace' && <WorkspacePanel />}
    </div>
  )
}
