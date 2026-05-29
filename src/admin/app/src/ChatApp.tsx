import { useEffect } from 'react'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatDashboard } from '@/components/chat/ChatDashboard'

export default function ChatApp() {
  useEffect(() => {
    document.title = 'VoiceClaw Chat'
  }, [])
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <ChatHeader />
      <ChatDashboard />
    </div>
  )
}
