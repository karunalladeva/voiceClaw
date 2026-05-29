import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ApprovalRequest } from '@/types/orchestration';

interface Props {
  approvals: ApprovalRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

const typeColors: Record<string, string> = {
  hire: 'bg-blue-900/30 text-blue-400',
  budget: 'bg-green-900/30 text-green-400',
  task: 'bg-purple-900/30 text-purple-400',
  strategy: 'bg-yellow-900/30 text-yellow-400',
  terminate: 'bg-red-900/30 text-red-400',
};

export function ApprovalsPanel({ approvals, onApprove, onReject }: Props) {
  if (approvals.length === 0) {
    return null;
  }

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Pending Approvals</CardTitle>
          <Badge variant="destructive" className="bg-orange-600">
            {approvals.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {approvals.map(approval => (
          <div
            key={approval.id}
            className="p-3 bg-gray-900/50 rounded-lg border border-gray-700"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge className={`text-xs ${typeColors[approval.type]}`}>
                    {approval.type}
                  </Badge>
                  <span className="text-xs text-gray-500">
                    {new Date(approval.createdAt).toLocaleString()}
                  </span>
                </div>
                <h4 className="font-medium text-sm">{approval.title}</h4>
              </div>
            </div>
            
            <p className="text-xs text-gray-400 mb-3 line-clamp-2">
              {approval.description}
            </p>
            
            <div className="flex gap-2">
              <button
                onClick={() => onApprove(approval.id)}
                className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-xs font-medium transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => onReject(approval.id)}
                className="flex-1 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded text-xs font-medium transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
