import { Lock, Activity, Star } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Model, SystemInfo } from '@/types'

interface SidebarProps {
  models: Model[]
  masterId: string | null
  settingMasterId: string | null
  system: SystemInfo | null
  onSetMaster: (id: string) => void
}

export function Sidebar({ models, masterId, settingMasterId, system, onSetMaster }: SidebarProps) {
  const enabledModels = models.filter((model) => model.enabled)

  return (
    <aside className="bg-card p-5 overflow-y-auto">
      <SectionTitle icon={<Lock className="w-3.5 h-3.5" />} title="Models" />

      <div className="flex flex-col gap-2.5">
        {enabledModels.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            {models.length === 0 ? 'Loading models...' : 'No enabled models'}
          </div>
        ) : (
          enabledModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              isMaster={model.id === masterId}
              isSetting={settingMasterId === model.id}
              onSelect={() => onSetMaster(model.id)}
            />
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
  className,
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

function ModelCard({
  model,
  isMaster,
  isSetting,
  onSelect,
}: {
  model: Model
  isMaster: boolean
  isSetting: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isSetting || isMaster}
      title={isMaster ? 'Current master model' : 'Set as master model'}
      className="w-full text-left disabled:cursor-default"
    >
      <Card
        className={cn(
          'p-3 transition-colors',
          isMaster
            ? 'border-primary bg-gradient-to-br from-primary/10 to-transparent'
            : 'hover:border-primary/50 hover:bg-secondary/40 cursor-pointer',
          isSetting && 'opacity-60'
        )}
      >
        <div className="flex items-center gap-2">
          {isMaster && <Star className="w-3.5 h-3.5 text-primary shrink-0 fill-primary" />}
          <span className="font-semibold text-sm truncate">
            {model.name || model.model}
          </span>
          {isMaster && (
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              MASTER
            </Badge>
          )}
          {isSetting && (
            <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground">
              ...
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {model.provider} • {model.model}
        </div>
      </Card>
    </button>
  )
}
