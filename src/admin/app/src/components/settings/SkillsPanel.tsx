import { useState } from 'react'
import { RefreshCw, Trash2, ChevronDown, ChevronRight, ArrowUpCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useLearnedSkills } from '@/hooks/useApi'
import { SettingsToast } from './SettingsControls'

export function SkillsPanel() {
  const { skills, loading, error, fetchSkills, deleteSkill, promoteSkill } = useLearnedSkills()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null)

  const showToast = (message: string, variant: 'success' | 'error' = 'success') => {
    setToast({ message, variant })
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      await deleteSkill(name)
      showToast('Skill deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error')
    }
  }

  const handlePromote = async (name: string) => {
    try {
      await promoteSkill(name, 'validated')
      showToast(`"${name}" promoted to validated`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Promote failed', 'error')
    }
  }

  if (loading) {
    return <div className="text-center py-16 text-muted-foreground">Loading learned skills...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Learned Skills</h2>
        <button
          type="button"
          onClick={fetchSkills}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-secondary"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      {skills.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">No learned skills yet.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {skills.map((skill) => {
            const isOpen = expanded === skill.name
            return (
              <Card key={skill.name} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : skill.name)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/50 transition-colors"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{skill.name}</span>
                      <Badge variant="default" className="text-[10px]">{skill.stage}</Badge>
                    </div>
                    {skill.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{skill.description}</p>
                    )}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-border">
                    <pre className="text-xs whitespace-pre-wrap font-mono bg-secondary/50 rounded-md p-3 mt-3 max-h-64 overflow-y-auto">
                      {skill.content}
                    </pre>
                    <div className="flex items-center gap-2 mt-3">
                      {skill.stage === 'draft' && (
                        <button
                          type="button"
                          onClick={() => handlePromote(skill.name)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary"
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                          Promote
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(skill.name)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md text-destructive border border-destructive/30 hover:bg-destructive/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {toast && <SettingsToast message={toast.message} variant={toast.variant} onDismiss={() => setToast(null)} />}
    </div>
  )
}
