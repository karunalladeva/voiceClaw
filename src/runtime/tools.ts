import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export function defineTool<T extends Record<string, unknown>>(def: {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  execute: (args: T) => Promise<string>;
}): ToolDefinition {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    execute: (args) => def.execute(def.schema.parse(args) as T),
  };
}

/** LangChain-compatible `tool(fn, config)` shape for migrated call sites. */
export function tool<T extends Record<string, unknown>>(
  execute: (args: T) => Promise<string>,
  config: { name: string; description: string; schema: z.ZodType<T> },
): ToolDefinition {
  return defineTool({ ...config, execute });
}

/** LangChain `DynamicStructuredTool` constructor shape. */
export function structuredTool<T extends Record<string, unknown>>(config: {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  func: (args: T) => Promise<string>;
}): ToolDefinition {
  return defineTool({
    name: config.name,
    description: config.description,
    schema: config.schema,
    execute: config.func,
  });
}

export interface ToolSchemaForLlm {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function toolToLlmSchema(tool: ToolDefinition): ToolSchemaForLlm {
  const parameters =
    tool.schema instanceof z.ZodObject
      ? zodToJsonSchema(tool.schema)
      : { type: 'object', properties: {} };
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
}

export function toolsToLlmSchemas(tools: ToolDefinition[]): ToolSchemaForLlm[] {
  return tools.map(toolToLlmSchema);
}

function zodToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(shape)) {
    const zodField = field as z.ZodTypeAny;
    properties[key] = zodFieldToJsonSchema(zodField);
    if (!zodField.isOptional()) {
      required.push(key);
    }
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  if (field instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: 'string' };
    if (field.description) out.description = field.description;
    return out;
  }
  if (field instanceof z.ZodNumber) return { type: 'number' };
  if (field instanceof z.ZodBoolean) return { type: 'boolean' };
  if (field instanceof z.ZodEnum) return { type: 'string', enum: field.options };
  if (field instanceof z.ZodArray) {
    return { type: 'array', items: zodFieldToJsonSchema(field.element) };
  }
  if (field instanceof z.ZodOptional) return zodFieldToJsonSchema(field.unwrap());
  if (field instanceof z.ZodDefault) return zodFieldToJsonSchema(field.removeDefault());
  return { type: 'string' };
}
