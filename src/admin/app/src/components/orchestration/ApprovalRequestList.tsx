import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import type { ApprovalRequest } from '@/types/orchestration';

interface Props {
  approvals: ApprovalRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onClarificationResponse?: (id: string, response: string) => void;
  variant?: 'admin' | 'chat';
  requesterName?: (approval: ApprovalRequest) => string;
}

const typeColorsAdmin: Record<string, string> = {
  hire: 'bg-blue-900/30 text-blue-400',
  budget: 'bg-green-900/30 text-green-400',
  task: 'bg-purple-900/30 text-purple-400',
  strategy: 'bg-yellow-900/30 text-yellow-400',
  terminate: 'bg-red-900/30 text-red-400',
  clarification: 'bg-cyan-900/30 text-cyan-400',
  work_escalation: 'bg-orange-900/30 text-orange-400',
};

const typeColorsChat: Record<string, string> = {
  hire: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  budget: 'bg-green-500/15 text-green-600 dark:text-green-400',
  task: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  strategy: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  terminate: 'bg-red-500/15 text-red-600 dark:text-red-400',
  clarification: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  work_escalation: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
};

export function ApprovalRequestList({
  approvals,
  onApprove,
  onReject,
  onClarificationResponse,
  variant = 'admin',
  requesterName,
}: Props) {
  const [clarifyText, setClarifyText] = useState<Record<string, string>>({});
  const isChat = variant === 'chat';
  const typeColors = isChat ? typeColorsChat : typeColorsAdmin;

  if (approvals.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {approvals.map((approval) => (
        <div
          key={approval.id}
          className={cn(
            'p-3 rounded-lg border',
            isChat
              ? 'bg-card border-border'
              : 'bg-gray-900/50 border-gray-700',
          )}
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge className={cn('text-xs', typeColors[approval.type])}>
                  {approval.type}
                </Badge>
                <span
                  className={cn(
                    'text-xs',
                    isChat ? 'text-muted-foreground' : 'text-gray-500',
                  )}
                >
                  {new Date(approval.createdAt).toLocaleString()}
                </span>
                {requesterName && (
                  <span
                    className={cn(
                      'text-xs',
                      isChat ? 'text-muted-foreground' : 'text-gray-500',
                    )}
                  >
                    from {requesterName(approval)}
                  </span>
                )}
              </div>
              <h4 className="font-medium text-sm">{approval.title}</h4>
            </div>
          </div>
          <div
            className={cn(
              'text-xs mb-3 max-h-32 overflow-y-auto',
              isChat ? 'text-muted-foreground' : 'text-gray-400',
            )}
          >
            <ChatMarkdown content={approval.description} className="text-xs" />
          </div>
          {approval.type === 'clarification' && onClarificationResponse && (
            <textarea
              value={clarifyText[approval.id] ?? ''}
              onChange={(e) =>
                setClarifyText((prev) => ({ ...prev, [approval.id]: e.target.value }))
              }
              placeholder="Your answer to the agent..."
              className={cn(
                'w-full px-3 py-2 mb-2 rounded text-xs min-h-[56px]',
                isChat
                  ? 'bg-background border border-border'
                  : 'bg-gray-900 border border-gray-700',
              )}
            />
          )}
          <div className="flex gap-2">
            {approval.type === 'clarification' && onClarificationResponse ? (
              <button
                type="button"
                onClick={() => {
                  const text = clarifyText[approval.id]?.trim();
                  if (text) onClarificationResponse(approval.id, text);
                }}
                className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-xs font-medium transition-colors text-white"
              >
                Send answer
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onApprove(approval.id)}
                className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-xs font-medium transition-colors text-white"
              >
                Approve
              </button>
            )}
            <button
              type="button"
              onClick={() => onReject(approval.id)}
              className={cn(
                'flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors',
                isChat
                  ? 'bg-destructive/10 hover:bg-destructive/20 text-destructive'
                  : 'bg-red-600/20 hover:bg-red-600/40 text-red-400',
              )}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
