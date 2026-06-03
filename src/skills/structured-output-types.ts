/**
 * Optional per-skill structured output contracts (declared in skill-manifest.json).
 * Runtime code is skill-agnostic — no skill ids or domain field names here.
 */

export type FieldSpec = {
  type: 'string' | 'number' | 'boolean' | 'string[]';
  required?: boolean;
  min?: number;
  max?: number;
};

export type StructuredItemSchema = {
  requiredFields: Record<string, FieldSpec>;
  optionalFields?: Record<string, FieldSpec>;
};

/** Only require a valid JSON object inside a ```json fence. */
export type StructuredOutputObjectConfig = {
  mode: 'object';
  missingMessage?: string;
};

/** Require a root array of fixed length with per-item field specs. */
export type StructuredOutputArrayConfig = {
  mode: 'array';
  arrayKey: string;
  arrayLength: number;
  itemSchema: StructuredItemSchema;
  optionalRootFields?: Record<string, FieldSpec>;
  missingMessage: string;
};

export type StructuredOutputConfig =
  | StructuredOutputObjectConfig
  | StructuredOutputArrayConfig;

export function isArrayStructuredOutput(
  config: StructuredOutputConfig,
): config is StructuredOutputArrayConfig {
  return config.mode === 'array';
}
