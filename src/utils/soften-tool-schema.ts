import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const TOOL_ARG_HINTS: Record<string, string> = {
  write_file:
    'Required JSON args: {"filename":"pipeline/workflow.json","content":"{\\"version\\":1,...}"}. ' +
    'Both filename and content must be non-empty strings.',
  read_file: 'Required JSON args: {"filename":"pipeline/workflow.json"}.',
  read_pointer:
    'Required: pointerId (UUID from pointer:… in context). Optional: maxChars (defaults to 120000).',
  create_subtask:
    'Required: title, description, assigneeId. Optional: priority, blockedBy.',
  pdf_generate: 'Required: markdown. Optional: title, outputFilename.',
  pdf_merge_files: 'Required: inputFiles (array of paths).',
  web_search: 'Required: query (string).',
  web_fetch: 'Required: url (string).',
};

export function formatMissingToolArgs(toolName: string, missing: string[]): string {
  const hint = TOOL_ARG_HINTS[toolName] ?? `Provide these fields: ${missing.join(', ')}.`;
  return (
    `Error: ${toolName} was called without required arguments: ${missing.join(', ')}. ` +
    `${hint} Do NOT call ${toolName} again with empty args {}.`
  );
}

function isMissingValue(value: unknown, fieldName: string): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && fieldName !== 'content' && !value.trim()) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function getRequiredKeys(shape: Record<string, z.ZodTypeAny>): string[] {
  return Object.entries(shape)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
}

/**
 * Relax required Zod fields so empty/malformed model tool calls reach func with a clear error
 * instead of LangChain schema exceptions that small models retry blindly.
 */
export function softenTool(tool: DynamicStructuredTool): DynamicStructuredTool {
  const schema = tool.schema;
  if (!(schema instanceof z.ZodObject)) {
    return tool;
  }
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const requiredKeys = getRequiredKeys(shape);
  if (requiredKeys.length === 0) {
    return tool;
  }
  const optionalShape: Record<string, z.ZodOptional<z.ZodTypeAny>> = {};
  for (const key of Object.keys(shape)) {
    optionalShape[key] = shape[key].optional();
  }
  const relaxed = z.object(optionalShape);
  const originalFunc = tool.func.bind(tool);
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: relaxed,
    func: async (input: Record<string, unknown>) => {
      const missing = requiredKeys.filter((k) => isMissingValue(input[k], k));
      if (missing.length > 0) {
        return formatMissingToolArgs(tool.name, missing);
      }
      return originalFunc(input);
    },
  });
}

export function softenTools(tools: DynamicStructuredTool[]): DynamicStructuredTool[] {
  return tools.map(softenTool);
}
