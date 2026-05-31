import { useEffect, useState } from 'react'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatDashboard } from '@/components/chat/ChatDashboard'
import { PipelinesDashboard } from '@/components/pipelines'
import { OrgDashboard } from '@/components/org'

type ChatView = 'chat' | 'pipelines' | 'org'

export default function ChatApp() {
  const [view, setView] = useState<ChatView>('chat')

  useEffect(() => {
    document.title =
      view === 'chat'
        ? 'VoiceClaw Chat'
        : view === 'pipelines'
          ? 'VoiceClaw Pipelines'
          : 'VoiceClaw Organization'
  }, [view])

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <ChatHeader view={view} onViewChange={setView} />
      {view === 'chat' ? (
        <ChatDashboard onOpenPipelines={() => setView('pipelines')} />
      ) : view === 'pipelines' ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex justify-center">
          <PipelinesDashboard />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex justify-center">
          <OrgDashboard />
        </div>
      )}
    </div>
  )
}
