import { z } from 'zod';

export const pipelinePhaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  assigneeId: z.string().optional(),
  assigneeName: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  responsibilities: z.array(z.string()).optional(),
  blockedAfter: z.string().nullable().optional(),
  readsFrom: z.array(z.string()).optional(),
  expectedOutputs: z.array(z.string()).optional(),
  requiresUserApproval: z.boolean().optional(),
});

export const pipelineWorkflowSchema = z.object({
  version: z.number().int().min(1),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),
  phases: z.array(pipelinePhaseSchema).min(1),
});

export type PipelinePhase = z.infer<typeof pipelinePhaseSchema>;
export type PipelineWorkflow = z.infer<typeof pipelineWorkflowSchema>;

export function defaultPipelineWorkflow(updatedBy?: string): PipelineWorkflow {
  return {
    version: 1,
    updatedAt: Date.now(),
    updatedBy,
    phases: [
      {
        id: 'market-research',
        title: 'Market Research',
        responsibilities: [
          'Find top 5 selling products with proof',
          'STOP AND ASK user to pick one before proceeding',
        ],
        blockedAfter: null,
        expectedOutputs: ['competitor-shortlist.md'],
        requiresUserApproval: true,
        skillIds: ['digital-product-research-fallback'],
      },
      {
        id: 'product-engineering',
        title: 'Product Engineering',
        blockedAfter: 'market-research',
        readsFrom: ['market-research'],
        responsibilities: ['Write improved chapters after user selection'],
        expectedOutputs: ['chapter-*.md', 'table-of-contents.md'],
      },
      {
        id: 'creative-design',
        title: 'Creative Design',
        blockedAfter: 'product-engineering',
        readsFrom: ['product-engineering'],
        responsibilities: ['Cover art and chapter images'],
        expectedOutputs: ['cover-*.png', 'images/'],
      },
      {
        id: 'creator',
        title: 'Creator',
        blockedAfter: 'creative-design',
        readsFrom: ['product-engineering', 'creative-design'],
        responsibilities: ['Assemble final PDF'],
        expectedOutputs: ['digital-product.pdf'],
      },
    ],
  };
}
