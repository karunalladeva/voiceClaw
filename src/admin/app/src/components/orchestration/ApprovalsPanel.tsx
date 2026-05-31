import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ApprovalRequest } from '@/types/orchestration';
import { ApprovalRequestList } from './ApprovalRequestList';

interface Props {
  approvals: ApprovalRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onClarificationResponse?: (id: string, response: string) => void;
}

export function ApprovalsPanel({ approvals, onApprove, onReject, onClarificationResponse }: Props) {
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
      <CardContent>
        <ApprovalRequestList
          variant="admin"
          approvals={approvals}
          onApprove={onApprove}
          onReject={onReject}
          onClarificationResponse={onClarificationResponse}
        />
      </CardContent>
    </Card>
  );
}
