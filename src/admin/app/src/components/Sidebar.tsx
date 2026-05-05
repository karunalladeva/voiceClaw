import { Lock, Activity } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Model, SystemInfo } from '@/types'

interface SidebarProps {
  models: Model[]
  masterId: string | null
  system: SystemInfo | null
}

export function Sidebar({ models, masterId, system }: SidebarProps) {
  return (
    <aside className="bg-card p-5 overflow-y-auto">
      <SectionTitle icon={<Lock className="w-3.5 h-3.5" />} title="Models" />
      
      <div className="flex flex-col gap-2.5">
        {models.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            Loading models...
          </div>
        ) : (
          models.map((model) => (
            <ModelCard key={model.id} model={model} isMaster={model.id === masterId} />
          ))
        )}
      </div>
      
      <SectionTitle icon={<Activity className="w-3.5 h-3.5" />} title="System" className="mt-8" />
      
      <Card className="p-3">
        <div className="font-semibold text-sm">
          {system ? `${system.platform} ${system.arch}` : '--'}
        </div>
        <div className="text-xs text-muted-foreground">
          {system ? `${system.cpuCount} cores • ${system.memoryUsagePercent}% memory` : '--'}
        </div>
      </Card>
    </aside>
  )
}

function SectionTitle({ 
  icon, 
  title, 
  className 
}: { 
  icon: React.ReactNode
  title: string
  className?: string 
}) {
  return (
    <div className={`flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-4 ${className}`}>
      {icon}
      {title}
    </div>
  )
}

function ModelCard({ model, isMaster }: { model: Model; isMaster: boolean }) {
  return (
    <Card className={`p-3 ${isMaster ? 'border-primary bg-gradient-to-br from-primary/10 to-transparent' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm truncate">
          {model.name || model.model}
        </span>
        {isMaster && (
          <Badge variant="default" className="text-[10px] px-1.5 py-0">
            MASTER
          </Badge>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {model.provider} • {model.enabled ? 'Enabled' : 'Disabled'}
      </div>
    </Card>
  )
}
