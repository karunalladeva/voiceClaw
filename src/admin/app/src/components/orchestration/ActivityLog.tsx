import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActivityEvent } from '@/types/orchestration';

interface Props {
  activity: ActivityEvent[];
}

const actionColors: Record<string, string> = {
  'agent:created': 'text-green-400',
  'agent:status_changed': 'text-blue-400',
  'agent:deleted': 'text-red-400',
  'task:created': 'text-purple-400',
  'task:checked_out': 'text-yellow-400',
  'task:completed': 'text-green-400',
  'task:released': 'text-gray-400',
  'task:status_changed': 'text-blue-400',
  'goal:created': 'text-purple-400',
  'company:created': 'text-green-400',
  'company:updated': 'text-blue-400',
  'approval:approved': 'text-green-400',
  'approval:rejected': 'text-red-400',
  'heartbeat:completed': 'text-blue-400',
  'heartbeat:failed': 'text-red-400',
};

function formatAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/:/g, ': ');
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ActivityLog({ activity }: Props) {
  if (activity.length === 0) {
    return (
      <Card className="bg-gray-800/50 border-gray-700">
        <CardContent className="p-6 text-center">
          <p className="text-gray-400">No activity yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[400px] overflow-y-auto">
        <div className="space-y-2">
          {activity.map(event => (
            <div
              key={event.id}
              className="flex items-start gap-3 p-2 hover:bg-gray-800/50 rounded transition-colors"
            >
              <div className="w-2 h-2 mt-2 rounded-full bg-gray-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${actionColors[event.action] || 'text-gray-300'}`}>
                    {formatAction(event.action)}
                  </span>
                  <span className="text-xs text-gray-500">{formatTime(event.timestamp)}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {event.actorType === 'agent' ? 'Agent' : event.actorType === 'human' ? 'User' : 'System'}: {event.actorId}
                  {event.data && Object.keys(event.data).length > 0 && (
                    <span className="ml-2">
                      {Object.entries(event.data)
                        .slice(0, 2)
                        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
                        .join(', ')}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
