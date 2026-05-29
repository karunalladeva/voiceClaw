import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { OrgAgent } from '@/types/orchestration';

interface Props {
  routines: any[];
  agents: OrgAgent[];
  companyId: string;
  onCreateRoutine?: (routine: any) => Promise<any>;
  onToggleRoutine?: (id: string, enabled: boolean) => Promise<any>;
  onDeleteRoutine?: (id: string) => Promise<any>;
}

export function RoutineList({ routines, agents, companyId, onCreateRoutine, onToggleRoutine, onDeleteRoutine }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSchedule, setNewSchedule] = useState('daily');
  const [newAssignee, setNewAssignee] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');

  const handleCreate = async () => {
    if (newName && newTaskTitle && newAssignee && onCreateRoutine) {
      await onCreateRoutine({
        companyId,
        name: newName,
        description: 'Scheduled recurring task',
        assigneeId: newAssignee,
        schedule: newSchedule,
        taskTemplate: {
          title: newTaskTitle,
          description: newTaskDesc,
          priority: newTaskPriority,
        },
      });
      setIsCreating(false);
      setNewName('');
      setNewTaskTitle('');
      setNewTaskDesc('');
      setNewAssignee('');
    }
  };

  const getAgentName = (id: string) => agents.find(a => a.id === id)?.name || 'Unknown';

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex justify-between items-center shrink-0">
        <h3 className="font-semibold text-lg text-white">Recurring Tasks (Routines)</h3>
        <button
          onClick={() => setIsCreating(true)}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-medium transition-colors"
        >
          + Add Routine
        </button>
      </div>

      {isCreating && (
        <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 shrink-0">
          <h4 className="text-sm font-medium mb-3">Create New Routine</h4>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <h5 className="text-xs font-semibold text-gray-500 uppercase">Schedule Settings</h5>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Routine Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="e.g., Daily Standup Report"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Schedule</label>
                  <select
                    value={newSchedule}
                    onChange={e => setNewSchedule(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Assignee</label>
                  <select
                    value={newAssignee}
                    onChange={e => setNewAssignee(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="">Select Agent...</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h5 className="text-xs font-semibold text-gray-500 uppercase">Generated Task</h5>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs text-gray-400">Task Title</label>
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                    placeholder="Task title to generate..."
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Priority</label>
                  <select
                    value={newTaskPriority}
                    onChange={e => setNewTaskPriority(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Task Description</label>
                <textarea
                  value={newTaskDesc}
                  onChange={e => setNewTaskDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500 h-16 resize-none"
                  placeholder="Task instructions..."
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2 pt-4 justify-end">
            <button
              onClick={() => setIsCreating(false)}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md text-sm font-medium transition-colors border border-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Save Routine
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0 overflow-y-auto pb-4">
        {routines.length === 0 ? (
          <p className="text-gray-500 text-sm col-span-full">No active routines.</p>
        ) : (
          routines.map(routine => (
            <Card key={routine.id} className={`bg-gray-800/80 border-gray-700 transition-colors ${!routine.enabled ? 'opacity-60' : ''}`}>
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="font-medium text-sm text-gray-200">{routine.name}</h4>
                    <p className="text-xs text-gray-500">Every {routine.schedule}</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button 
                      onClick={() => onToggleRoutine && onToggleRoutine(routine.id, !routine.enabled)}
                      className={`text-xs px-2 py-1 rounded border ${routine.enabled ? 'bg-green-900/30 text-green-400 border-green-800 hover:bg-green-900/50' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'}`}
                    >
                      {routine.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    {onDeleteRoutine && (
                      <button 
                        onClick={() => onDeleteRoutine(routine.id)}
                        className="text-gray-500 hover:text-red-400"
                        title="Delete Routine"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="bg-gray-900/50 p-3 rounded text-sm space-y-2 border border-gray-700/50">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Assignee</span>
                    <span className="font-medium text-gray-300 text-xs">{getAgentName(routine.assigneeId)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Creates Task</span>
                    <Badge variant="outline" className="text-[10px]">{routine.taskTemplate.priority}</Badge>
                  </div>
                  <p className="text-xs text-gray-300 truncate mt-1">"{routine.taskTemplate.title}"</p>
                </div>
                
                <div className="mt-3 text-[10px] text-gray-500 text-right">
                  Next run: {routine.nextRunAt ? new Date(routine.nextRunAt).toLocaleString() : 'Pending'}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}