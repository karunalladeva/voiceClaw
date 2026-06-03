import { stripOrchestratorToolAppendix } from './skill-handoff';
import type {
  FieldSpec,
  StructuredOutputArrayConfig,
  StructuredOutputConfig,
} from '../skills/structured-output-types';
import { isArrayStructuredOutput } from '../skills/structured-output-types';

export const STRUCTURED_OUTPUT_MARKER = '[STRUCTURED_OUTPUT]';

export type StructuredOutputAssessment = {
  valid: boolean;
  payload: Record<string, unknown> | null;
  errors: string[];
};

export function extractJsonObjectFromText(text: string): unknown | null {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const candidates = fence ? [fence[1]] : [text];
  for (const raw of candidates) {
    const trimmed = raw.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1) continue;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

function validateField(
  value: unknown,
  spec: FieldSpec,
  path: string,
  errors: string[],
): unknown {
  if (value === undefined || value === null) {
    if (spec.required) errors.push(`${path} is required.`);
    return undefined;
  }
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string' || !value.trim()) {
        errors.push(`${path} must be a non-empty string.`);
        return undefined;
      }
      return value.trim();
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        errors.push(`${path} must be a number.`);
        return undefined;
      }
      if (spec.min != null && n < spec.min) errors.push(`${path} must be >= ${spec.min}.`);
      if (spec.max != null && n > spec.max) errors.push(`${path} must be <= ${spec.max}.`);
      return n;
    }
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${path} must be a boolean.`);
        return undefined;
      }
      return value;
    case 'string[]':
      if (!Array.isArray(value)) {
        errors.push(`${path} must be an array of strings.`);
        return undefined;
      }
      return value.filter((v): v is string => typeof v === 'string');
    default:
      return value;
  }
}

function validateArrayPayload(
  input: unknown,
  schema: StructuredOutputArrayConfig,
): StructuredOutputAssessment {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, payload: null, errors: ['Root must be a JSON object.'] };
  }
  const root = input as Record<string, unknown>;
  const arr = root[schema.arrayKey];
  if (!Array.isArray(arr)) {
    return {
      valid: false,
      payload: null,
      errors: [`Missing "${schema.arrayKey}" array.`],
    };
  }
  if (arr.length !== schema.arrayLength) {
    errors.push(
      `"${schema.arrayKey}" must have exactly ${schema.arrayLength} entries (got ${arr.length}).`,
    );
  }
  const normalizedRows: Record<string, unknown>[] = [];
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    const prefix = `${schema.arrayKey}[${i}]`;
    if (!row || typeof row !== 'object') {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    const r = row as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(schema.itemSchema.requiredFields)) {
      normalized[key] = validateField(
        r[key],
        { ...spec, required: true },
        `${prefix}.${key}`,
        errors,
      );
    }
    if (schema.itemSchema.optionalFields) {
      for (const [key, spec] of Object.entries(schema.itemSchema.optionalFields)) {
        const v = validateField(r[key], spec, `${prefix}.${key}`, errors);
        if (v !== undefined) normalized[key] = v;
      }
    }
    normalizedRows.push(normalized);
  }
  const payload: Record<string, unknown> = { [schema.arrayKey]: normalizedRows };
  if (schema.optionalRootFields) {
    for (const [key, spec] of Object.entries(schema.optionalRootFields)) {
      const v = validateField(root[key], spec, key, errors);
      if (v !== undefined) payload[key] = v;
    }
  }
  if (errors.length > 0) {
    return { valid: false, payload, errors };
  }
  return { valid: true, payload, errors: [] };
}

function validateObjectPayload(input: unknown): StructuredOutputAssessment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, payload: null, errors: ['Root must be a JSON object.'] };
  }
  return { valid: true, payload: input as Record<string, unknown>, errors: [] };
}

export function assessStructuredOutput(
  assistantText: string,
  config: StructuredOutputConfig,
): StructuredOutputAssessment {
  const parsed = extractJsonObjectFromText(assistantText);
  if (!parsed) {
    const msg =
      config.mode === 'array'
        ? config.missingMessage
        : config.missingMessage ?? 'Required ```json``` block with a JSON object.';
    return { valid: false, payload: null, errors: [msg] };
  }
  if (isArrayStructuredOutput(config)) {
    return validateArrayPayload(parsed, config);
  }
  return validateObjectPayload(parsed);
}

export function enrichHandoffWithStructuredOutput(
  handoff: string,
  config: StructuredOutputConfig | undefined,
  runIncomplete: boolean,
): { handoff: string; valid: boolean } {
  if (!config) {
    return { handoff, valid: true };
  }
  const narrative = stripOrchestratorToolAppendix(
    handoff.replace(/\[SKILL_RUN_INCOMPLETE\][^\n]*\n?/i, ''),
  );
  const assessment = assessStructuredOutput(narrative, config);
  const valid = assessment.valid;

  if (valid && assessment.payload) {
    return {
      handoff:
        handoff +
        `\n\n${STRUCTURED_OUTPUT_MARKER}\n\`\`\`json\n${JSON.stringify(assessment.payload, null, 2)}\n\`\`\`\n`,
      valid: true,
    };
  }
  const missing =
    config.mode === 'array'
      ? config.missingMessage
      : config.missingMessage ?? 'Missing required ```json``` object.';
  return {
    handoff:
      handoff +
      `\n\n${STRUCTURED_OUTPUT_MARKER} INVALID or missing — do not treat run as complete.\n` +
      (assessment.errors.length > 0 ? assessment.errors : [missing]).map((e) => `- ${e}`).join('\n') +
      '\n',
    valid: false,
  };
}
