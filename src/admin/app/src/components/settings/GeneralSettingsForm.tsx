import { useEffect, useState } from 'react'
import type { AppConfig } from '@/types'
import { useConfig } from '@/hooks/useApi'
import { clearAllChatHistory } from '@/lib/chatApi'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsTextField,
  SettingsSelect,
  SettingsSwitch,
  SettingsSlider,
  SettingsNavButton,
  SettingsDangerButton,
  SettingsToast,
} from './SettingsControls'

import type { SettingsTab } from './settings-tabs'

interface GeneralSettingsFormProps {
  onNavigate: (tab: SettingsTab) => void
}

const defaultForm: AppConfig = {
  llm: { model: 'qwen3.5:9b', temperature: 0.2 },
  stt: { mode: 'transcribe' },
  tts: { engine: 'kokoro', defaultVoice: 'af_heart' },
  agent: { enableInternet: true, maxParallelSkills: 2, skillQueueTimeoutMs: 30000 },
  memory: { enabled: true },
  learning: {
    autoMemoryStore: true,
    autoSkillCreate: true,
    autoMacroCreate: true,
    retryOnFail: true,
    maxRetries: 3,
  },
  cache: { mode: 'memory', redisUrl: 'redis://localhost:6379' },
  voiceHandling: { vadEnabled: true, wakeWordEnabled: false, autoListen: false },
  assistantName: 'Claw',
}

export function GeneralSettingsForm({ onNavigate }: GeneralSettingsFormProps) {
  const { config, loading, saving, saveConfig } = useConfig()
  const [form, setForm] = useState<AppConfig>(defaultForm)
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)
  const [clearingHistory, setClearingHistory] = useState(false)

  useEffect(() => {
    if (config) {
      setForm({
        llm: { ...defaultForm.llm, ...config.llm },
        stt: { ...defaultForm.stt, ...config.stt },
        tts: { ...defaultForm.tts, ...config.tts },
        agent: { ...defaultForm.agent, ...config.agent },
        memory: { ...defaultForm.memory, ...config.memory },
        learning: { ...defaultForm.learning, ...config.learning },
        cache: { ...defaultForm.cache, ...config.cache },
        voiceHandling: { ...defaultForm.voiceHandling, ...config.voiceHandling },
        assistantName: config.assistantName ?? defaultForm.assistantName,
      })
    }
  }, [config])

  const handleSave = async () => {
    const ok = await saveConfig(form)
    setToast({
      message: ok ? 'Preferences updated successfully' : 'Failed to save configuration',
      variant: ok ? 'success' : 'error',
    })
  }

  const handleClearAllHistory = async () => {
    if (
      !confirm(
        'Delete ALL saved conversations (Telegram, WhatsApp, admin chats, pipelines)?\n\nSummaries and archived messages will be removed. This cannot be undone.',
      )
    ) {
      return
    }
    setClearingHistory(true)
    try {
      const result = await clearAllChatHistory()
      setToast({ message: result.message, variant: 'success' })
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to clear history',
        variant: 'error',
      })
    } finally {
      setClearingHistory(false)
    }
  }

  if (loading && !config) {
    return <div className="text-center py-16 text-muted-foreground">Loading configuration...</div>
  }

  return (
    <div className="max-w-2xl">
      <SettingsSection title="AI Models & Hardware" />
      <SettingsCard>
        <SettingsRow label="Model Name">
          <SettingsTextField
            value={form.llm.model}
            onChange={(v) => setForm((f) => ({ ...f, llm: { ...f.llm, model: v } }))}
            placeholder="llama3.1"
          />
        </SettingsRow>
        <SettingsRow label="Temperature">
          <SettingsSlider
            value={form.llm.temperature}
            min={0}
            max={1}
            onChange={(v) => setForm((f) => ({ ...f, llm: { ...f.llm, temperature: v } }))}
          />
        </SettingsRow>
        <SettingsRow label="Manage AI Models" subtitle="Add, configure, and switch local/remote providers.">
          <SettingsNavButton label="Open Models" onClick={() => onNavigate('models')} />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection title="Assistant Capabilities" />
      <SettingsCard>
        <SettingsRow label="Identity Name">
          <SettingsTextField
            value={form.assistantName}
            onChange={(v) => setForm((f) => ({ ...f, assistantName: v }))}
            placeholder="e.g. Claw"
          />
        </SettingsRow>
        <SettingsRow
          label="Internet Search Access"
          subtitle="Allows the LLM to autonomously retrieve live web data."
        >
          <SettingsSwitch
            checked={form.agent.enableInternet}
            onChange={(v) => setForm((f) => ({ ...f, agent: { ...f.agent, enableInternet: v } }))}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection title="Speech & Audio Engine" />
      <SettingsCard>
        <SettingsRow label="Input Mode">
          <SettingsSelect
            value={form.stt.mode}
            onChange={(v) => setForm((f) => ({ ...f, stt: { mode: v } }))}
            options={[
              { value: 'transcribe', label: 'Local Transcribe (Whisper)' },
              { value: 'direct', label: 'Direct Audio Socket' },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="TTS Engine">
          <SettingsSelect
            value={form.tts.engine}
            onChange={(v) => setForm((f) => ({ ...f, tts: { ...f.tts, engine: v } }))}
            options={[
              { value: 'kokoro', label: 'Kokoro-JS (Local Edge)' },
              { value: 'qwen', label: 'Qwen-TTS (Python)' },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Default Voice Pattern">
          <SettingsTextField
            value={form.tts.defaultVoice}
            onChange={(v) => setForm((f) => ({ ...f, tts: { ...f.tts, defaultVoice: v } }))}
            placeholder="af_heart"
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection title="Voice Conversational Fluidity" />
      <SettingsCard>
        <SettingsRow
          label="Wake-Word Detection"
          subtitle="Passively listens locally for the Assistant Name."
        >
          <SettingsSwitch
            checked={form.voiceHandling.wakeWordEnabled}
            onChange={(v) =>
              setForm((f) => ({ ...f, voiceHandling: { ...f.voiceHandling, wakeWordEnabled: v } }))
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Voice Activity Detection"
          subtitle="Automatically transmits audio prompts when you stop speaking."
        >
          <SettingsSwitch
            checked={form.voiceHandling.vadEnabled}
            onChange={(v) =>
              setForm((f) => ({ ...f, voiceHandling: { ...f.voiceHandling, vadEnabled: v } }))
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Continuous Conversation"
          subtitle="Restarts the microphone seamlessly after the Agent replies."
        >
          <SettingsSwitch
            checked={form.voiceHandling.autoListen}
            onChange={(v) =>
              setForm((f) => ({ ...f, voiceHandling: { ...f.voiceHandling, autoListen: v } }))
            }
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection title="Machine Memory & Learning" />
      <SettingsCard>
        <SettingsRow
          label="Infinite Long-Term Memory"
          subtitle="Agent stores contextual data over distinct sessions."
        >
          <SettingsSwitch
            checked={form.memory.enabled}
            onChange={(v) => setForm((f) => ({ ...f, memory: { enabled: v } }))}
          />
        </SettingsRow>
        <SettingsRow
          label="Auto-Extract Experiences"
          subtitle="Silently commits facts and personal data during chats."
        >
          <SettingsSwitch
            checked={form.learning.autoMemoryStore}
            onChange={(v) => setForm((f) => ({ ...f, learning: { ...f.learning, autoMemoryStore: v } }))}
          />
        </SettingsRow>
        <SettingsRow label="View Raw Memories" subtitle="Inspect graph database entries.">
          <SettingsNavButton label="Open Memory" onClick={() => onNavigate('memory')} />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection title="Self-Improving Graph Engine" />
      <SettingsCard>
        <SettingsRow
          label="Autonomous Skill Creation"
          subtitle="The agent writes tools for itself to solve unknown challenges."
        >
          <SettingsSwitch
            checked={form.learning.autoSkillCreate}
            onChange={(v) => setForm((f) => ({ ...f, learning: { ...f.learning, autoSkillCreate: v } }))}
          />
        </SettingsRow>
        <SettingsRow
          label="Iterative Task Retries"
          subtitle="Agent observes tool trace failures and patches its execution logic."
        >
          <SettingsSwitch
            checked={form.learning.retryOnFail}
            onChange={(v) => setForm((f) => ({ ...f, learning: { ...f.learning, retryOnFail: v } }))}
          />
        </SettingsRow>
        {form.learning.retryOnFail && (
          <SettingsRow label="Max Remediation Attempts">
            <SettingsSlider
              value={form.learning.maxRetries}
              min={1}
              max={5}
              step={1}
              onChange={(v) =>
                setForm((f) => ({ ...f, learning: { ...f.learning, maxRetries: Math.round(v) } }))
              }
            />
          </SettingsRow>
        )}
        <SettingsRow label="Browse Source Repositories" subtitle="View injected deterministic macro pipelines.">
          <SettingsNavButton label="Open Skills" onClick={() => onNavigate('skills')} />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection title="Workspace & Storage" />
      <SettingsCard>
        <SettingsRow label="Browse Workspace Files" subtitle="View and manage data, media, and skill files.">
          <SettingsNavButton label="Open Workspace" onClick={() => onNavigate('workspace')} />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection title="Conversation history" />
      <SettingsCard>
        <SettingsRow
          label="Clear all chat history"
          subtitle="Deletes every file in workspace/chats (all channels and admin chats), summaries, and response caches."
        >
          <SettingsDangerButton
            label="Clear history"
            onClick={() => void handleClearAllHistory()}
            disabled={clearingHistory}
            loading={clearingHistory}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsSection title="System Architecture" />
      <SettingsCard>
        <SettingsRow label="Graph State Cache">
          <SettingsSelect
            value={form.cache.mode}
            onChange={(v) => setForm((f) => ({ ...f, cache: { ...f.cache, mode: v } }))}
            options={[
              { value: 'memory', label: 'Node.js V8 In-Memory (Fastest)' },
              { value: 'redis', label: 'Redis (Distributed IPC)' },
            ]}
          />
        </SettingsRow>
        {form.cache.mode === 'redis' && (
          <SettingsRow label="Redis Host URL">
            <SettingsTextField
              value={form.cache.redisUrl ?? ''}
              onChange={(v) => setForm((f) => ({ ...f, cache: { ...f.cache, redisUrl: v } }))}
              placeholder="redis://localhost:6379"
              className="w-56"
            />
          </SettingsRow>
        )}
      </SettingsCard>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-8 w-full py-3 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>

      {toast && (
        <SettingsToast
          message={toast.message}
          variant={toast.variant}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}

export type { SettingsTab }
