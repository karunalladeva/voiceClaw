import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { BaseSkill, SkillDefinition } from './base-skill';
import { historyManager } from '../agents/agent-history';
import {
  Pipeline, PipelineStep, StepResult,
  loadPipelines, savePipelines, computeNextRun, runPipeline,
  startPipelineTicker
} from '../pipeline/pipeline-engine';
import { loadChannels, saveChannels, getSupportedChannels, ChannelConfig } from '../pipeline/channels';

// Import steps so they register themselves at load time
import '../pipeline/steps';

// ── RRule helper ──────────────────────────────────────────────────────────────

function tryParseRRule(schedule: string): string {
  // If it's already an RRule string, keep it
  if (schedule.toUpperCase().startsWith('FREQ=') || schedule.toUpperCase().startsWith('RRULE:')) {
    return schedule;
  }
  // Otherwise keep as natural language (engine handles it)
  return schedule;
}

function describeSchedule(schedule: string): string {
  try {
    const { RRule } = require('rrule');
    if (schedule.toUpperCase().includes('FREQ=')) {
      const clean = schedule.replace(/^RRULE:/i, '');
      const rule = RRule.fromString(clean);
      return rule.toText();
    }
  } catch { }
  return schedule;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

function makeTools(): DynamicStructuredTool[] {

  // ── Pipeline CRUD ──

  const createPipeline = new DynamicStructuredTool({
    name: 'create_pipeline',
    description:
      'Create an automated pipeline. A pipeline is a chain of steps that execute sequentially. ' +
      'Step types: ai_task, research, browse, summarize, generate_doc, deliver, save_history. ' +
      'Schedule formats: "every 30 minutes", "every day", "every week", ISO datetime for one-time, ' +
      'or RRule string like "FREQ=DAILY;BYHOUR=9;BYMINUTE=0". ' +
      'Example: research movies → summarize → deliver to discord. ' +
      'Each step has a type and config object with step-specific params.',
    schema: z.object({
      name: z.string().describe('Human-readable pipeline name'),
      trigger: z.enum(['scheduled', 'manual']).describe('How the pipeline triggers'),
      schedule: z.string().optional().describe('Schedule string (required if trigger is "scheduled")'),
      steps: z.array(z.object({
        type: z.enum(['ai_task', 'research', 'browse', 'summarize', 'generate_doc', 'deliver', 'save_history']),
        config: z.record(z.any()).describe(
          'Step config. Keys vary by type:\n' +
          '  ai_task: { prompt, chat_id }\n' +
          '  research: { query, max_results }\n' +
          '  browse: { url, selector?, extract?, screenshot?, headless? }\n' +
          '  summarize: { prompt? }\n' +
          '  generate_doc: { prompt?, template_path?, output_path? }\n' +
          '  deliver: { channel: discord|telegram|whatsapp|email|history, message?, settings? }\n' +
          '  save_history: { chat_id?, tag? }'
        ),
      })).describe('Ordered list of pipeline steps'),
    }),
    func: async ({ name, trigger, schedule, steps }) => {
      const pipelines = await loadPipelines();
      const pipeline: Pipeline = {
        id: `pipe_${Date.now()}`,
        name,
        trigger,
        schedule: schedule ? tryParseRRule(schedule) : undefined,
        steps: steps as PipelineStep[],
        enabled: true,
        createdAt: Date.now(),
      };
      if (trigger === 'scheduled' && schedule) {
        pipeline.nextRun = computeNextRun(pipeline);
      }
      pipelines.push(pipeline);
      await savePipelines(pipelines);
      const schedDesc = schedule ? describeSchedule(schedule) : 'manual trigger only';
      return `✅ Pipeline "${name}" created (${pipeline.id}).\n` +
        `Trigger: ${trigger} — ${schedDesc}\n` +
        `Steps: ${steps.map((s, i) => `${i + 1}. ${s.type}`).join(' → ')}\n` +
        (pipeline.nextRun ? `Next run: ${new Date(pipeline.nextRun).toLocaleString()}` : '');
    },
  });

  const setMultiReminder = new DynamicStructuredTool({
    name: 'set_multi_reminder',
    description: 'Set multiple one-time reminders for different times. Example: "Remind me in 5 mins, 1 hour, and 3 hours".',
    schema: z.object({
      message: z.string().describe('The reminder text.'),
      delaysMinutes: z.array(z.number()).describe('An array of minutes from now for each reminder. e.g. [5, 60, 180]'),
    }),
    func: async ({ message, delaysMinutes }) => {
      const pipelines = await loadPipelines();
      const results: string[] = [];
      const now = Date.now();

      for (const mins of delaysMinutes) {
        const targetTime = now + (mins * 60_000);
        const pipeline: Pipeline = {
          id: `pipe_remind_${Date.now()}_${mins}`,
          name: `Reminder: ${message.substring(0, 20)} (+${mins}m)`,
          trigger: 'scheduled',
          schedule: new Date(targetTime).toISOString(),
          steps: [
            { type: 'deliver', config: { channel: 'push', title: 'Reminder', message } },
            { type: 'deliver', config: { channel: 'history', message: `⏰ REMINDER: ${message}` } }
          ],
          enabled: true,
          createdAt: Date.now(),
          nextRun: targetTime
        };
        pipelines.push(pipeline);
        results.push(new Date(targetTime).toLocaleTimeString());
      }
      await savePipelines(pipelines);
      return `✅ ${delaysMinutes.length} reminders set for: ${results.join(', ')}.`;
    }
  });

  const listPipelines = new DynamicStructuredTool({
    name: 'list_pipelines',
    description: 'List all pipelines with their status, schedule, and steps.',
    schema: z.object({}),
    func: async () => {
      const pipelines = await loadPipelines();
      if (pipelines.length === 0) return 'No pipelines configured.';
      return pipelines.map(p => {
        const next = p.nextRun ? new Date(p.nextRun).toLocaleString() : 'n/a';
        const last = p.lastRun ? new Date(p.lastRun).toLocaleString() : 'never';
        return `• [${p.id}] **${p.name}** (${p.enabled ? '🟢' : '🔴'})\n` +
          `  Trigger: ${p.trigger} | Schedule: ${p.schedule || 'none'}\n` +
          `  Steps: ${p.steps.map(s => s.type).join(' → ')}\n` +
          `  Last: ${last} | Next: ${next}`;
      }).join('\n\n');
    },
  });

  const runPipelineNow = new DynamicStructuredTool({
    name: 'run_pipeline_now',
    description: 'Immediately execute a pipeline by its ID.',
    schema: z.object({
      id: z.string().describe('Pipeline ID to run'),
    }),
    func: async ({ id }) => {
      const pipelines = await loadPipelines();
      const pipeline = pipelines.find(p => p.id === id);
      if (!pipeline) return `❌ Pipeline "${id}" not found.`;
      const { success, outputs } = await runPipeline(pipeline);
      await savePipelines(pipelines); // save updated lastRun/nextRun
      const summary = outputs.map((o, i) =>
        `Step ${i + 1}: ${o.success ? '✅' : '❌'} ${o.output.substring(0, 200)}`
      ).join('\n');
      return `Pipeline "${pipeline.name}" ${success ? 'completed ✅' : 'had errors ⚠️'}\n\n${summary}`;
    },
  });

  const deletePipeline = new DynamicStructuredTool({
    name: 'delete_pipeline',
    description: 'Delete a pipeline by ID.',
    schema: z.object({
      id: z.string().describe('Pipeline ID to delete'),
    }),
    func: async ({ id }) => {
      const pipelines = await loadPipelines();
      const filtered = pipelines.filter(p => p.id !== id);
      if (filtered.length === pipelines.length) return `❌ No pipeline "${id}" found.`;
      await savePipelines(filtered);
      return `✅ Pipeline "${id}" deleted.`;
    },
  });

  const togglePipeline = new DynamicStructuredTool({
    name: 'toggle_pipeline',
    description: 'Enable or disable a pipeline.',
    schema: z.object({
      id: z.string().describe('Pipeline ID'),
      enabled: z.boolean().describe('true to enable, false to disable'),
    }),
    func: async ({ id, enabled }) => {
      const pipelines = await loadPipelines();
      const p = pipelines.find(p => p.id === id);
      if (!p) return `❌ Pipeline "${id}" not found.`;
      p.enabled = enabled;
      if (enabled && p.trigger === 'scheduled') {
        p.nextRun = computeNextRun(p);
      }
      await savePipelines(pipelines);
      return `✅ Pipeline "${p.name}" is now ${enabled ? 'enabled 🟢' : 'disabled 🔴'}.`;
    },
  });

  // ── Channel Configuration ──

  const configureChannel = new DynamicStructuredTool({
    name: 'configure_channel',
    description:
      'Save or update a delivery channel configuration. ' +
      'Supported: discord (webhook_url), telegram (bot_token, chat_id), ' +
      'whatsapp (twilio_sid, twilio_token, from_number, to_number), ' +
      'email (smtp_host, smtp_port, email_user, email_pass, to_email), ' +
      'history (chat_id).',
    schema: z.object({
      type: z.enum(['discord', 'telegram', 'whatsapp', 'email', 'history']),
      name: z.string().describe('Display name for this channel config'),
      settings: z.record(z.string()).describe('Channel-specific key-value settings'),
    }),
    func: async ({ type, name, settings }) => {
      const channels = await loadChannels();
      const existing = channels.findIndex(c => c.type === type);
      const config: ChannelConfig = { type, name, settings, enabled: true };
      if (existing >= 0) {
        channels[existing] = config;
      } else {
        channels.push(config);
      }
      await saveChannels(channels);
      return `✅ Channel "${name}" (${type}) configured successfully.`;
    },
  });

  const listChannels = new DynamicStructuredTool({
    name: 'list_channels',
    description: 'List all configured delivery channels.',
    schema: z.object({}),
    func: async () => {
      const channels = await loadChannels();
      if (channels.length === 0) {
        return `No channels configured.\nSupported: ${getSupportedChannels().join(', ')}`;
      }
      return channels.map(c =>
        `• **${c.name}** (${c.type}) — ${c.enabled ? '🟢' : '🔴'}\n  Keys: ${Object.keys(c.settings).join(', ')}`
      ).join('\n');
    },
  });

  // ── Simple Reminders (for small models) ──

  const setReminder = new DynamicStructuredTool({
    name: 'set_reminder',
    description: 'Set a simple delayed reminder. Use this instead of create_pipeline when the user just wants a reminder in a few minutes or hours. Example: "Remind me in 5 minutes".',
    schema: z.object({
      message: z.string().describe('The reminder text to present to the user.'),
      delayMinutes: z.number().describe('How many minutes from now to trigger the reminder. Example: 5 for 5 minutes, 60 for 1 hour.'),
    }),
    func: async ({ message, delayMinutes }) => {
      const pipelines = await loadPipelines();
      const delayMs = delayMinutes * 60_000;
      const targetTime = Date.now() + delayMs;
      
      const pipeline: Pipeline = {
        id: `pipe_remind_${Date.now()}`,
        name: `Reminder: ${message.substring(0, 20)}`,
        trigger: 'scheduled',
        schedule: new Date(targetTime).toISOString(), // One-time ISO trigger
        steps: [
          { type: 'deliver', config: { channel: 'push', title: 'Reminder', message } },
          { type: 'deliver', config: { channel: 'history', message: `⏰ REMINDER: ${message}` } }
        ],
        enabled: true,
        createdAt: Date.now(),
        nextRun: targetTime
      };
      pipelines.push(pipeline);
      await savePipelines(pipelines);
      return `✅ Reminder set for ${new Date(targetTime).toLocaleTimeString()}: "${message}"`;
    }
  });

  // ── Memory / History ──

  const saveToHistory = new DynamicStructuredTool({
    name: 'save_to_history',
    description:
      'Save notes/preferences/information to chat memory for recall later. ' +
      'Use proactively when user shares important info.',
    schema: z.object({
      chatId: z.string().describe('Chat ID').default('default'),
      note: z.string().describe('The note to save'),
      tag: z.string().optional().describe('Tag: preference, reminder, fact, etc.'),
    }),
    func: async ({ chatId, note, tag }) => {
      const { SystemMessage } = await import('@langchain/core/messages');
      const thread = historyManager.getThread(chatId);
      const content = tag ? `[Memory:${tag}] ${note}` : `[Memory] ${note}`;
      thread.push(new SystemMessage({ content }));
      historyManager.setThread(chatId, thread);
      await historyManager.saveChat(chatId);
      return `✅ Saved: "${content}"`;
    },
  });

  const getHistory = new DynamicStructuredTool({
    name: 'get_history_summary',
    description: 'Retrieve conversation history / saved memories.',
    schema: z.object({
      chatId: z.string().describe('Chat ID').default('default'),
    }),
    func: async ({ chatId }) => {
      const thread = historyManager.getThread(chatId);
      if (thread.length === 0) return 'No history for this conversation.';
      return thread.map((m, i) =>
        `[${i + 1}] (${m.getType()}): ${m.content.toString().substring(0, 200)}`
      ).join('\n');
    },
  });

  return [
    createPipeline, listPipelines, runPipelineNow, deletePipeline, togglePipeline,
    configureChannel, listChannels,
    saveToHistory, getHistory, setReminder, setMultiReminder,
  ];
}

// ── Skill Definition ──────────────────────────────────────────────────────────

export default class SchedulerSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: 'scheduler',
      name: 'Pipeline & Scheduler && Reminter && Taker',
      description: 'Create multi-step automated pipelines with scheduling, web research, browser automation, document generation, and delivery to Discord/Telegram/WhatsApp/Email.',
      triggerDescription:
        'Use when user asks to: schedule tasks, create automations, set reminders, ' +
        'build pipelines (research → summarize → deliver), configure delivery channels, ' +
        'run recurring jobs, remember information, save/recall notes, find and send content automatically.',
      systemPrompt: `You are the Pipeline & Scheduler agent. You build composable multi-step automation pipelines.

PIPELINE STEPS (run sequentially, output chains to next):
1. research — web search, returns results
2. browse — open URLs via Playwright, extract data
3. summarize — LLM-powered summarization of previous output
4. generate_doc — create documents from templates + context
5. ai_task — run any prompt through the main AI agent
6. deliver — send to: discord, telegram, whatsapp, email, or history
7. save_history — save output to chat memory

SCHEDULE FORMATS: "every 30 minutes", "every day", "every week", ISO datetime, or RRule "FREQ=DAILY;BYHOUR=9"

DELIVERY CHANNELS: discord (webhook), telegram (bot), whatsapp (twilio), email (smtp), history (local)

Current time: ${new Date().toISOString()}

When building pipelines, design intelligent step chains. For example:
- "Find movie reviews" → research → summarize → deliver to discord
- "Daily job check" → browse linkedin → ai_task (extract jobs) → generate_doc (resume) → deliver to email
- "Remember my preference" → save_to_history`,
      tools: makeTools(),
      enabled: true,
    };
  }
}
