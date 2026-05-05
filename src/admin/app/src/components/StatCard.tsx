import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/utils'

interface StatCardProps {
  value: number | string
  label: string
  subLabel?: string
  variant?: 'default' | 'warning' | 'error'
}

export function StatCard({ value, label, subLabel, variant = 'default' }: StatCardProps) {
  const numValue = typeof value === 'number' ? formatNumber(value) : value
  
  return (
    <Card
      className={cn(
        "p-5 hover:border-primary hover:shadow-[0_0_20px_rgba(99,102,241,0.3)] cursor-default",
        variant === 'warning' && "border-warning shadow-[0_0_18px_rgba(245,158,11,0.2)]",
        variant === 'error' && "border-destructive shadow-[0_0_18px_rgba(239,68,68,0.25)]"
      )}
    >
      <div className="text-3xl font-bold tabular-nums">{numValue}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
      {subLabel && (
        <div className="text-xs text-muted-foreground mt-1.5">{subLabel}</div>
      )}
    </Card>
  )
}
