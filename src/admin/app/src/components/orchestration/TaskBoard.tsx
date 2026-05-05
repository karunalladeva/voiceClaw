import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Task, TaskStatus, TaskPriority, OrgAgent } from '@/types/orchestration';

interface Props {
  tasks: Task[];
  agents: OrgAgent[];
  companyId: string;
  onTaskClick?: (task: Task) => void;
  onCreateTask?: (task: Partial<Task>) => Promise<any>;
  onRunNow?: (agentId: string) => void;
}

const columns: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'backlog', label: 'Backlog', color: 'gray' },
  { status: 'todo', label: 'To Do', color: 'blue' },
  { status: 'in_progress', label: 'In Progress', color: 'yellow' },
  { status: 'review', label: 'Review', color: 'purple' },
  { status: 'done', label: 'Done', color: 'green' },
];

const priorityColors: Record<TaskPriority, string> = {
  critical: 'text-red-400 bg-red-900/30',
  high: 'text-orange-400 bg-orange-900/30',
  medium: 'text-yellow-400 bg-yellow-900/30',
  low: 'text-gray-400 bg-gray-700/50',
};

function TaskCard({ task, agents, onTaskClick, onRunNow }: { task: Task; agents: OrgAgent[]; onTaskClick?: (task: Task) => void; onRunNow?: (agentId: string) => void }) {
  const assignee = agents.find(a => a.id === task.assigneeId);
  const checkedOut = agents.find(a => a.id === task.checkedOutBy);

  return (
    <Card
      className="bg-gray-800/80 border-gray-700 hover:border-gray-600 transition-colors cursor-pointer mb-2 relative group"
      onClick={() => onTaskClick?.(task)}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-medium text-sm leading-tight">{task.title}</h4>
          <Badge className={`text-xs shrink-0 ${priorityColors[task.priority]}`}>
            {task.priority}
          </Badge>
        </div>
        
        {task.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {task.labels.map(label => (
              <span
                key={label}
                className="px-1.5 py-0.5 text-xs bg-gray-700 rounded text-gray-400"
              >
                {label}
              </span>
            ))}
          </div>
        )}
        
        <div className="flex items-center justify-between text-xs text-gray-500">
          {assignee ? (
            <span className="flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[10px]">
                {assignee.name.charAt(0)}
              </span>
              {assignee.name}
            </span>
          ) : (
            <span className="text-gray-600">Unassigned</span>
          )}
          
          {checkedOut ? (
            <span className="text-yellow-500">Working...</span>
          ) : (
            assignee && onRunNow && (task.status === 'todo' || task.status === 'backlog') ? (
              <button
                onClick={(e) => { e.stopPropagation(); onRunNow(assignee.id); }}
                className="px-2 py-0.5 bg-green-600 hover:bg-green-500 text-white rounded text-[10px] font-medium transition-all opacity-0 group-hover:opacity-100"
                title="Wake Agent (Trigger Heartbeat)"
              >
                Run Now
              </button>
            ) : null
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function TaskBoard({ tasks, agents, companyId, onTaskClick, onCreateTask, onRunNow }: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<any>('medium');
  const [newAssignee, setNewAssignee] = useState('');

  const handleCreate = async () => {
    if (newTitle && onCreateTask) {
      await onCreateTask({
        companyId,
        title: newTitle,
        description: newDesc,
        priority: newPriority,
        assigneeId: newAssignee || undefined,
        createdBy: 'admin',
      });
      setIsCreating(false);
      setNewTitle('');
      setNewDesc('');
      setNewAssignee('');
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex justify-between items-center shrink-0">
        <h3 className="font-semibold text-lg text-white">Tasks</h3>
        <button
          onClick={() => setIsCreating(true)}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-medium transition-colors"
        >
          + Add Task
        </button>
      </div>

      {isCreating && (
        <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-700 shrink-0">
          <h4 className="text-sm font-medium mb-3">Create New Task</h4>
          <div className="grid grid-cols-4 gap-4 items-start">
            <div className="col-span-2 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="Task title..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Description</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500 h-20 resize-none"
                  placeholder="Details..."
                />
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Priority</label>
                <select
                  value={newPriority}
                  onChange={e => setNewPriority(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Assignee</label>
                <select
                  value={newAssignee}
                  onChange={e => setNewAssignee(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">Unassigned</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex flex-col gap-2 justify-end h-full">
              <button
                onClick={handleCreate}
                className="w-full py-2 bg-green-600 hover:bg-green-500 text-white rounded-md text-sm font-medium transition-colors"
              >
                Save Task
              </button>
              <button
                onClick={() => setIsCreating(false)}
                className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md text-sm font-medium transition-colors border border-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-4 flex-1 min-h-0">
      {columns.map(col => {
        const columnTasks = tasks.filter(t => t.status === col.status);
        
        return (
          <div key={col.status} className="flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-gray-300">{col.label}</h3>
              <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                {columnTasks.length}
              </span>
            </div>
            
            <div className="flex-1 min-h-[200px] bg-gray-900/30 rounded-lg p-2 overflow-y-auto max-h-[500px]">
              {columnTasks.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-4">No tasks</p>
              ) : (
                columnTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    agents={agents}
                    onTaskClick={onTaskClick}
                    onRunNow={onRunNow}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
