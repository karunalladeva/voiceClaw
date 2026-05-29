import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function SettingsSection({ title }: { title: string }) {
  return (
    <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mt-6 mb-3 px-1">
      {title}
    </h3>
  )
}

export function SettingsCard({ children }: { children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children]
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {items.filter(Boolean)}
    </Card>
  )
}

export function SettingsRow({
  label,
  subtitle,
  children,
  className,
}: {
  label: string
  subtitle?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-4 py-3', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsTextField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'w-48 bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring',
        className
      )}
    />
  )
}

export function SettingsSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-56 bg-secondary border border-border rounded-md px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

export function SettingsSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        checked ? 'bg-primary' : 'bg-muted'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}

export function SettingsSlider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
}) {
  return (
    <div className="flex items-center gap-3 w-56">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-primary"
      />
      <span className="text-sm text-primary font-semibold w-10 text-right">
        {format ? format(value) : value.toFixed(step >= 1 ? 0 : 2)}
      </span>
    </div>
  )
}

export function SettingsNavButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm text-primary hover:underline"
    >
      {label} →
    </button>
  )
}

export function SettingsToast({
  message,
  variant = 'success',
  onDismiss,
}: {
  message: string
  variant?: 'success' | 'error'
  onDismiss: () => void
}) {
  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg',
        variant === 'success' ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'
      )}
    >
      <div className="flex items-center gap-3">
        <span>{message}</span>
        <button type="button" onClick={onDismiss} className="opacity-70 hover:opacity-100">✕</button>
      </div>
    </div>
  )
}
