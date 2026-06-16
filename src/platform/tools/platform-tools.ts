import { defineTool, type ToolDefinition } from '../../runtime/tools';
import { z } from 'zod';
import { configManager } from '../../config/index';
import { readOrgArtifactAuditStamp } from '../context/artifact-audit-read';
import { sessionContextService, PointerScopeError } from '../context/session-context-service';
import { sessionRagIndex } from '../context/session-rag';
import type { RunContext } from '../contracts';

export function createReadPointerTool(getRunContext: () => RunContext | undefined): ToolDefinition {
  return defineTool({
    name: 'read_pointer',
    description:
      'Load full payload for a HandoffPointer id (UUID from pointer:… in context). ' +
      'maxChars is optional. For upstream markdown files use read_file on artifact paths instead.',
    schema: z.object({
      pointerId: z.string().describe('HandoffPointer UUID from pointer:… in task context'),
      maxChars: z.number().optional().describe('Optional read cap (default 120000)'),
    }),
    execute: async ({ pointerId, maxChars }) => {
      const ctx = getRunContext();
      if (!ctx) return 'No active run context.';
      if (configManager.getConfig().agent?.context?.pointers?.enabled !== true) {
        return 'Pointer reads are disabled.';
      }
      const rootTaskId = ctx.rootTaskId ?? ctx.orgTaskId;
      if (rootTaskId) {
        const auditBody = await readOrgArtifactAuditStamp(rootTaskId, pointerId);
        if (auditBody) {
          const cap = maxChars ?? 120_000;
          return auditBody.length > cap
            ? auditBody.slice(0, cap) + '\n...[truncated at read cap]'
            : auditBody;
        }
      }
      try {
        return await sessionContextService.resolvePointerFlexible(ctx.scopeId, pointerId, {
          maxBytes: maxChars ?? 120_000,
          audit: (msg) => console.log(`[Platform:Context] ${msg}`),
        });
      } catch (err) {
        if (err instanceof PointerScopeError) return err.message;
        return `read_pointer failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

export function createSearchSessionOutputsTool(getRunContext: () => RunContext | undefined): ToolDefinition {
  return defineTool({
    name: 'search_session_outputs',
    description: 'BM25 search over indexed session tool/skill outputs in the current scope.',
    schema: z.object({
      query: z.string(),
      k: z.number().optional(),
    }),
    execute: async ({ query, k }) => {
      const ctx = getRunContext();
      if (!ctx) return 'No active run context.';
      if (configManager.getConfig().agent?.context?.sessionRag?.enabled !== true) {
        return 'Session RAG is disabled.';
      }
      const hits = await sessionRagIndex.search(ctx.scopeId, query, k ?? 5);
      if (hits.length === 0) return 'No session outputs matched.';
      return hits
        .map((h, i) => `${i + 1}. [${h.title}] pointer:${h.pointerId}\n${h.excerpt}`)
        .join('\n\n');
    },
  });
}

export function buildPlatformTools(getRunContext: () => RunContext | undefined): ToolDefinition[] {
  const cfg = configManager.getConfig().agent?.context;
  const tools: ToolDefinition[] = [];
  if (cfg?.pointers?.enabled) tools.push(createReadPointerTool(getRunContext));
  if (cfg?.sessionRag?.enabled) tools.push(createSearchSessionOutputsTool(getRunContext));
  return tools;
}
