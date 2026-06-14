import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SETTINGS_MORE_TAB_GROUPS,
  SETTINGS_MORE_TABS,
  SETTINGS_PRIMARY_TABS,
  type SettingsTab,
} from './settings-tabs'

interface SettingsTabNavProps {
  activeTab: SettingsTab
  onSelect: (tab: SettingsTab) => void
}

const MORE_TAB_IDS = new Set(SETTINGS_MORE_TABS.map((t) => t.id))

function tabButtonClass(active: boolean): string {
  return cn(
    'shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
    active
      ? 'border-primary text-primary'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  )
}

export function SettingsTabNav({ activeTab, onSelect }: SettingsTabNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const moreActive = MORE_TAB_IDS.has(activeTab)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const handleSelect = (tab: SettingsTab) => {
    onSelect(tab)
    setMenuOpen(false)
  }

  const activeMoreLabel = SETTINGS_MORE_TABS.find((t) => t.id === activeTab)?.label

  return (
    <div className="flex items-center gap-0 mb-6 border-b border-border pb-0" role="tablist">
      {SETTINGS_PRIMARY_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => handleSelect(tab.id)}
          className={tabButtonClass(activeTab === tab.id)}
        >
          {tab.label}
        </button>
      ))}

      <div className="relative shrink-0 ml-auto" ref={menuRef}>
        <button
          type="button"
          role="tab"
          aria-selected={moreActive}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((open) => !open)}
          className={cn(
            tabButtonClass(moreActive),
            'flex items-center gap-1 pl-3 pr-2',
          )}
        >
          <span>{moreActive && activeMoreLabel ? activeMoreLabel : 'More'}</span>
          <ChevronDown
            className={cn('w-4 h-4 transition-transform', menuOpen && 'rotate-180')}
            aria-hidden
          />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] rounded-md border border-border bg-popover py-1 shadow-lg"
          >
            {SETTINGS_MORE_TAB_GROUPS.map((group, groupIndex) => (
              <div key={group.label}>
                {groupIndex > 0 && <div className="my-1 border-t border-border" />}
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {group.tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(tab.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm transition-colors',
                      activeTab === tab.id
                        ? 'bg-primary/15 text-primary font-medium'
                        : 'text-foreground hover:bg-secondary/80',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
