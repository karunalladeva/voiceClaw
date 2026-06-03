import type {
  FieldSpec,
  StructuredOutputConfig,
  StructuredItemSchema,
} from '../skills/structured-output-types';

function parseFieldSpec(raw: unknown, path: string): FieldSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type !== 'string' && type !== 'number' && type !== 'boolean' && type !== 'string[]') {
    console.warn(`[structured-output] ${path}: invalid field type`);
    return null;
  }
  return {
    type,
    required: o.required === true,
    min: typeof o.min === 'number' ? o.min : undefined,
    max: typeof o.max === 'number' ? o.max : undefined,
  };
}

function parseItemSchema(raw: unknown): StructuredItemSchema | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const requiredFields: Record<string, FieldSpec> = {};
  if (o.requiredFields && typeof o.requiredFields === 'object') {
    for (const [key, spec] of Object.entries(o.requiredFields as Record<string, unknown>)) {
      const parsed = parseFieldSpec(spec, `requiredFields.${key}`);
      if (parsed) requiredFields[key] = parsed;
    }
  }
  const optionalFields: Record<string, FieldSpec> = {};
  if (o.optionalFields && typeof o.optionalFields === 'object') {
    for (const [key, spec] of Object.entries(o.optionalFields as Record<string, unknown>)) {
      const parsed = parseFieldSpec(spec, `optionalFields.${key}`);
      if (parsed) optionalFields[key] = parsed;
    }
  }
  if (Object.keys(requiredFields).length === 0) return null;
  return {
    requiredFields,
    optionalFields: Object.keys(optionalFields).length > 0 ? optionalFields : undefined,
  };
}

/** Parse optional `structuredOutput` from skill-manifest.json — returns undefined if absent/invalid. */
export function parseStructuredOutputFromManifest(raw: unknown): StructuredOutputConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const mode = o.mode;
  if (mode === 'object') {
    return {
      mode: 'object',
      missingMessage:
        typeof o.missingMessage === 'string' ? o.missingMessage : undefined,
    };
  }
  if (mode !== 'array') {
    if (mode != null) {
      console.warn('[structured-output] Unknown mode — use "object" or "array"');
    }
    return undefined;
  }
  const arrayKey = typeof o.arrayKey === 'string' ? o.arrayKey : '';
  const arrayLength = typeof o.arrayLength === 'number' ? o.arrayLength : 0;
  const itemSchema = parseItemSchema(o.itemSchema);
  const missingMessage =
    typeof o.missingMessage === 'string' ? o.missingMessage : '';
  if (!arrayKey || arrayLength < 1 || !itemSchema || !missingMessage) {
    console.warn('[structured-output] Invalid array structuredOutput — skipped');
    return undefined;
  }
  const optionalRootFields: Record<string, FieldSpec> = {};
  if (o.optionalRootFields && typeof o.optionalRootFields === 'object') {
    for (const [key, spec] of Object.entries(o.optionalRootFields as Record<string, unknown>)) {
      const parsed = parseFieldSpec(spec, `optionalRootFields.${key}`);
      if (parsed) optionalRootFields[key] = parsed;
    }
  }
  return {
    mode: 'array',
    arrayKey,
    arrayLength,
    itemSchema,
    optionalRootFields:
      Object.keys(optionalRootFields).length > 0 ? optionalRootFields : undefined,
    missingMessage,
  };
}
