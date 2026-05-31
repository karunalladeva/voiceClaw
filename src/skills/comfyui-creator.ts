import { BaseSkill, SkillDefinition } from './base-skill';
import { configManager } from '../config/index';
import { comfyuiTools } from '../tools/comfyui';

export default class ComfyUICreatorSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    const enabled = configManager.getConfig().comfyui.enabled;
    return {
      id: 'comfyui-creator',
      name: 'ComfyUI Creator',
      description: 'Generates images and videos using a local ComfyUI server.',
      triggerDescription:
        'Use when the user asks to create, generate, draw, or make an image, picture, illustration, or video/animation.',
      systemPrompt:
        'You are a ComfyUI media generation specialist. ' +
        'Always call comfyui_list_workflows first and pick the best workflow by id. ' +
        'Prefer workspace workflows (source: workspace) over bundled defaults — they match the user\'s installed models. ' +
        'Only use txt2img-basic or txt2video-basic if no workspace workflow fits. ' +
        'Do not retry comfyui_generate more than once on failure; report the error clearly. ' +
        'For long video jobs, set waitForCompletion to false and poll with comfyui_check_job. ' +
        'Always report output file paths and URLs when generation succeeds. ' +
        'Keep your spoken response brief and natural — the user will hear it aloud.',
      tools: comfyuiTools,
      enabled,
      category: 'creative',
      tags: ['comfyui', 'image', 'video', 'generation'],
    };
  }
}
