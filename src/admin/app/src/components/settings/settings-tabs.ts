export type SettingsTab =
  | 'general'
  | 'models'
  | 'memory'
  | 'skills'
  | 'workspace'
  | 'channels'
  | 'searxng'
  | 'comfyui'
  | 'llamacpp'
  | 'micro-router'

export interface SettingsTabItem {
  id: SettingsTab
  label: string
}

export interface SettingsTabGroup {
  label: string
  tabs: SettingsTabItem[]
}

/** Shown inline in the top tab bar. */
export const SETTINGS_PRIMARY_TABS: SettingsTabItem[] = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' },
  { id: 'memory', label: 'Memory' },
  { id: 'skills', label: 'Skills' },
  { id: 'channels', label: 'Channels' },
]

/** Shown in the “More” dropdown at the end of the tab bar. */
export const SETTINGS_MORE_TAB_GROUPS: SettingsTabGroup[] = [
  {
    label: 'Integrations',
    tabs: [
      { id: 'searxng', label: 'SearXNG' },
      { id: 'comfyui', label: 'ComfyUI' },
      { id: 'llamacpp', label: 'llama.cpp' },
      { id: 'micro-router', label: 'Micro-router' },
    ],
  },
  {
    label: 'Data',
    tabs: [{ id: 'workspace', label: 'Workspace' }],
  },
]

export const SETTINGS_MORE_TABS: SettingsTabItem[] = SETTINGS_MORE_TAB_GROUPS.flatMap((g) => g.tabs)

export const SETTINGS_TABS: SettingsTabItem[] = [
  ...SETTINGS_PRIMARY_TABS,
  ...SETTINGS_MORE_TABS,
]
