import { defineTool } from '../runtime/tools';
import { z } from 'zod';
import { comfyUIService } from '../services/comfyui-service';

function formatGenerateResult(result: Awaited<ReturnType<typeof comfyUIService.generate>>): string {
  if (result.status === 'failed') {
    return `Generation failed: ${result.error ?? 'unknown error'}`;
  }
  if (result.outputs.length === 0) {
    return `Job ${result.promptId} is ${result.status}. Use comfyui_check_job to poll status.`;
  }
  const lines = result.outputs.map((o) => {
    if (o.type === 'image') {
      return `- image: ${o.filename}\n  ![${o.filename}](${o.url})`;
    }
    if (o.type === 'video') {
      return `- video: ${o.filename} (url: ${o.url})`;
    }
    return `- ${o.type}: ${o.localPath} (url: ${o.url})`;
  });
  return `Generation complete (prompt_id: ${result.promptId}).\n${lines.join('\n')}`;
}

export const comfyuiListWorkflowsTool = defineTool({
  name: 'comfyui_list_workflows',
    description: 'List available ComfyUI image and video generation workflows (bundled and user custom).',
    schema: z.object({}),
  execute: async () => {
    try {
      const workflows = comfyUIService.listWorkflows();
      if (workflows.length === 0) {
        return 'No ComfyUI workflows found. Add JSON files to template/comfyui/ or workspace/comfyui/workflows/.';
      }
      return (
        'Available workflows (prefer workspace over bundled when both exist):\n' +
        workflows
          .map((w) => `- ${w.id} (${w.type}, ${w.source}): ${w.name} — ${w.description}`)
          .join('\n')
      );
    } catch (err: any) {
      return `Error listing workflows: ${err.message}`;
    }
  },
});

export const comfyuiGenerateTool = defineTool({
  name: 'comfyui_generate',
    description:
      'Generate an image or video using ComfyUI. Call comfyui_list_workflows first; prefer workspace workflows (source: workspace) over bundled defaults.',
    schema: z.object({
      workflowId: z.string().describe('Workflow ID from comfyui_list_workflows'),
      prompt: z.string().describe('Positive prompt describing what to generate'),
      negativePrompt: z.string().optional().describe('Negative prompt to avoid unwanted elements'),
      width: z.number().optional().describe('Output width in pixels'),
      height: z.number().optional().describe('Output height in pixels'),
      seed: z.number().optional().describe('Random seed for reproducibility'),
      waitForCompletion: z.boolean().default(true).describe('Wait for job to finish; set false for long video jobs'),
    }),
  execute: async ({ workflowId, prompt, negativePrompt, width, height, seed, waitForCompletion }) => {
    try {
      const result = await comfyUIService.generate({
        workflowId,
        prompt,
        negativePrompt,
        width,
        height,
        seed,
        waitForCompletion,
      });
      return formatGenerateResult(result);
    } catch (err: any) {
      return `ComfyUI generation error: ${err.message}`;
    }
  },
});

export const comfyuiCheckJobTool = defineTool({
  name: 'comfyui_check_job',
    description: 'Check status of a ComfyUI generation job by prompt_id (for long-running video jobs).',
    schema: z.object({
      promptId: z.string().describe('The prompt_id returned from comfyui_generate'),
    }),
  execute: async ({ promptId }) => {
    try {
      const job = comfyUIService.getJob(promptId);
      if (!job) {
        return `No job found for prompt_id: ${promptId}`;
      }
      if (job.status === 'completed' && job.outputs.length > 0) {
        return formatGenerateResult(job);
      }
      if (job.status === 'failed') {
        return `Job failed: ${job.error ?? 'unknown error'}`;
      }
      return `Job ${promptId} status: ${job.status}. Check again in a few seconds.`;
    } catch (err: any) {
      return `Error checking job: ${err.message}`;
    }
  },
});

export const comfyuiTools = [comfyuiListWorkflowsTool, comfyuiGenerateTool, comfyuiCheckJobTool];
