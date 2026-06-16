import { systemMessage, userMessage } from '../runtime/messages';
import { modelRouter } from '../models/model-router';
import { modelRegistry } from '../models/model-registry';
import type { CreatorItemType } from './workspace-creator';

export class CreatorPolicyError extends Error {
  public readonly code = 'creator_policy_violation';
  public readonly details: string[];
  constructor(message: string, details: string[]) {
    super(message);
    this.details = details;
    this.name = 'CreatorPolicyError';
  }
}

export class CreatorValidationError extends Error {
  public readonly code = 'creator_validation_failed';
  constructor(message: string) {
    super(message);
    this.name = 'CreatorValidationError';
  }
}

export interface CreatorLlmRequest {
  type: CreatorItemType;
  name: string;
  purpose: string;
  prompt: string;
  currentContent?: string;
}

export interface CreatorLlmResult {
  content: string;
  modelId: string;
}

const MAX_TEMPLATE_STEPS = 30;

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\b/i, reason: 'Destructive Unix delete command is blocked.' },
  { pattern: /\bdel\s+\/f\s+\/q\b/i, reason: 'Destructive Windows delete command is blocked.' },
  { pattern: /\breg\s+add\b/i, reason: 'Windows registry mutation command is blocked.' },
  { pattern: /\bnetsh\s+advfirewall\b/i, reason: 'Firewall mutation command is blocked.' },
  { pattern: /\b(api[_-]?key|secret|token|password)\b.*\b(read|dump|exfiltrat|print)\b/i, reason: 'Credential extraction behavior is blocked.' },
];

function getModelIdForAudit(): string {
  return modelRegistry.getBestFor('code')?.id || modelRegistry.getMaster()?.id || 'unknown-model';
}

function getSystemPrompt(type: CreatorItemType, isRegenerate: boolean): string {
  const action = isRegenerate ? 'regenerate' : 'generate';
  if (type === 'skill') {
    return [
      `You are a secure creator assistant. Your task is to ${action} a SKILL.md document.`,
      'Output only markdown for SKILL.md.',
      'Do not include code fences.',
      'Safety constraints:',
      '- Never include destructive shell commands.',
      '- Never include credential exfiltration instructions.',
      '- Never include auto-execution instructions.',
    ].join('\n');
  }
  if (type === 'mcp') {
    return [
      `You are a secure creator assistant. Your task is to ${action} an MCP definition.`,
      'Output only valid JSON object for mcp.json.',
      'No markdown. No comments. No trailing commas.',
      'Required top-level keys: name, purpose, description, tools.',
      'tools must be an array, each tool must declare explicit schema/parameters.',
      'Do not include hidden side-effect tools.',
      'Never include unsafe defaults.',
    ].join('\n');
  }
  return [
    `You are a secure creator assistant. Your task is to ${action} a pipeline template.`,
    'Output only valid JSON object for template.json.',
    'No markdown. No comments. No trailing commas.',
    'Required top-level keys: id, name, category, description, steps.',
    `steps must be an array with at most ${MAX_TEMPLATE_STEPS} items.`,
    'Each step must have type and config.',
  ].join('\n');
}

function buildUserPrompt(input: CreatorLlmRequest): string {
  const base = [
    `Name: ${input.name}`,
    `Purpose: ${input.purpose}`,
    `Type: ${input.type}`,
    `User prompt: ${input.prompt || 'No extra prompt provided.'}`,
  ];
  if (input.currentContent) {
    base.push('Current content follows. Use it as context and improve it safely.');
    base.push(input.currentContent);
  }
  return base.join('\n\n');
}

function ensureJsonObject(raw: string): any {
  const trimmed = raw.trim();
  const normalized = trimmed.startsWith('```') ? trimmed.replace(/^```[a-z]*\n?/i, '').replace(/\n```$/i, '') : trimmed;
  const parsed = JSON.parse(normalized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CreatorValidationError('Generated JSON must be an object.');
  }
  return parsed;
}

function validateMcpObject(parsed: any): void {
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) throw new CreatorValidationError('mcp.name is required');
  if (typeof parsed.purpose !== 'string' || !parsed.purpose.trim()) throw new CreatorValidationError('mcp.purpose is required');
  if (typeof parsed.description !== 'string' || !parsed.description.trim()) throw new CreatorValidationError('mcp.description is required');
  if (!Array.isArray(parsed.tools)) throw new CreatorValidationError('mcp.tools must be an array');
}

function validateTemplateObject(parsed: any): void {
  if (typeof parsed.id !== 'string' || !parsed.id.trim()) throw new CreatorValidationError('template.id is required');
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) throw new CreatorValidationError('template.name is required');
  if (typeof parsed.category !== 'string' || !parsed.category.trim()) throw new CreatorValidationError('template.category is required');
  if (!Array.isArray(parsed.steps)) throw new CreatorValidationError('template.steps must be an array');
  if (parsed.steps.length > MAX_TEMPLATE_STEPS) throw new CreatorValidationError(`template.steps cannot exceed ${MAX_TEMPLATE_STEPS}`);
  for (const step of parsed.steps) {
    if (!step || typeof step !== 'object') throw new CreatorValidationError('template step must be an object');
    if (typeof step.type !== 'string' || !step.type.trim()) throw new CreatorValidationError('template step.type is required');
    if (!step.config || typeof step.config !== 'object' || Array.isArray(step.config)) {
      throw new CreatorValidationError('template step.config must be an object');
    }
  }
}

function validateByType(type: CreatorItemType, raw: string): string {
  if (type === 'skill') return raw.trim();
  const parsed = ensureJsonObject(raw);
  if (type === 'mcp') validateMcpObject(parsed);
  if (type === 'template') validateTemplateObject(parsed);
  return JSON.stringify(parsed, null, 2);
}

function enforcePolicy(type: CreatorItemType, prompt: string, content: string): void {
  const issues: string[] = [];
  const combined = `${prompt}\n${content}`;
  for (const entry of FORBIDDEN_PATTERNS) {
    if (entry.pattern.test(combined)) {
      issues.push(entry.reason);
    }
  }
  const lower = combined.toLowerCase();
  if (lower.includes('download and execute') || lower.includes('curl') && lower.includes('| sh')) {
    issues.push('Remote download-and-execute behavior is blocked.');
  }
  if (type === 'template') {
    try {
      const parsed = ensureJsonObject(content);
      if (Array.isArray(parsed.steps) && parsed.steps.some((step: any) => typeof step?.type === 'string' && /shell|exec|command/i.test(step.type))) {
        issues.push('Template shell/exec step types require explicit manual review and are blocked by default.');
      }
    } catch {
      // Validation stage handles parse errors.
    }
  }
  if (issues.length > 0) {
    throw new CreatorPolicyError('Generated content violated creator safety policy.', issues);
  }
}

async function invokeCreatorModel(type: CreatorItemType, prompt: string, currentContent?: string): Promise<CreatorLlmResult> {
  const llm = await modelRouter.getModel('code');
  const modelId = getModelIdForAudit();
  const response = await llm.complete({
    messages: [
      systemMessage(getSystemPrompt(type, Boolean(currentContent))),
      userMessage(prompt),
    ],
    label: `creator:${type}`,
  });
  const content = String(response.content ?? '').trim();
  if (!content) {
    throw new CreatorValidationError('LLM returned empty content.');
  }
  return { content, modelId };
}

async function validateWithRepair(type: CreatorItemType, prompt: string, rawContent: string): Promise<string> {
  try {
    return validateByType(type, rawContent);
  } catch (err: any) {
    if (type === 'skill') throw err;
    const repairPrompt = [
      'Fix this output to valid JSON only.',
      `Type: ${type}`,
      'Constraints: preserve intent, required schema keys, no comments, no markdown.',
      'Original content:',
      rawContent,
    ].join('\n\n');
    const repaired = await invokeCreatorModel(type, repairPrompt);
    return validateByType(type, repaired.content);
  }
}

export async function generateCreatorContent(input: CreatorLlmRequest): Promise<CreatorLlmResult> {
  const requestPrompt = buildUserPrompt(input);
  const generated = await invokeCreatorModel(input.type, requestPrompt);
  const validated = await validateWithRepair(input.type, requestPrompt, generated.content);
  enforcePolicy(input.type, input.prompt, validated);
  return { content: validated, modelId: generated.modelId };
}

export async function regenerateCreatorContent(input: CreatorLlmRequest): Promise<CreatorLlmResult> {
  const requestPrompt = buildUserPrompt(input);
  const generated = await invokeCreatorModel(input.type, requestPrompt, input.currentContent);
  const validated = await validateWithRepair(input.type, requestPrompt, generated.content);
  enforcePolicy(input.type, input.prompt, validated);
  return { content: validated, modelId: generated.modelId };
}
