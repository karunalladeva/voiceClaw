import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as os from 'os';
import { BaseSkill, SkillDefinition } from './base-skill';

// ── Tools ──────────────────────────────────────────────────────────────────

const listEnvTool = tool(
  async () => {
    const env = process.env;
    const lines = Object.entries(env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    return `Found ${lines.length} environment variables:\n${lines.join('\n')}`;
  },
  {
    name: 'list_env_vars',
    description: 'List all OS environment variables available to the server process.',
    schema: z.object({}),
  }
);

const getEnvTool = tool(
  async ({ name }) => {
    const value = process.env[name];
    if (value === undefined) {
      return `Environment variable "${name}" is not set.`;
    }
    return `${name}=${value}`;
  },
  {
    name: 'get_env_var',
    description: 'Get the value of a specific environment variable by name.',
    schema: z.object({
      name: z.string().describe('The environment variable name (case-sensitive on Linux/macOS)'),
    }),
  }
);

const getSystemInfoTool = tool(
  async () => {
    return JSON.stringify({
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      username: os.userInfo().username,
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
      cpus: os.cpus().length,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      uptimeSeconds: Math.round(os.uptime()),
      nodeVersion: process.version,
      cwd: process.cwd(),
    }, null, 2);
  },
  {
    name: 'get_system_info',
    description: 'Get general OS and system information: platform, architecture, memory, CPU count, uptime.',
    schema: z.object({}),
  }
);

const searchEnvTool = tool(
  async ({ query }) => {
    const q = query.toLowerCase();
    const matches = Object.entries(process.env)
      .filter(([k, v]) => k.toLowerCase().includes(q) || (v ?? '').toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    if (matches.length === 0) return `No environment variables matching "${query}" found.`;
    return `Found ${matches.length} match(es) for "${query}":\n${matches.join('\n')}`;
  },
  {
    name: 'search_env_vars',
    description: 'Search environment variables by name or value substring.',
    schema: z.object({
      query: z.string().describe('Case-insensitive search term to match against variable names or values'),
    }),
  }
);

// ── Skill ──────────────────────────────────────────────────────────────────

export default class OsEnvSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: 'os-env',
      name: 'OS Environment Reader',
      description: 'Reads, searches, and reports on OS environment variables and system information.',
      triggerDescription:
        'Use when the user asks about environment variables, PATH, system settings, OS info, ' +
        'memory, CPU, platform, hostname, or any system-level configuration.',
      systemPrompt:
        'You are a system information specialist. You can read OS environment variables and ' +
        'retrieve system information using your tools.\n' +
        '- Use get_system_info for general OS/hardware questions.\n' +
        '- Use get_env_var to look up a specific variable by exact name.\n' +
        '- Use search_env_vars to find variables by keyword.\n' +
        '- Use list_env_vars when the user wants to see all variables.\n' +
        'Keep your response concise and natural for speech. ' +
        'Never expose sensitive values like passwords or API keys in full — truncate to first 4 characters.',
      tools: [listEnvTool, getEnvTool, searchEnvTool, getSystemInfoTool],
      enabled: true,
    };
  }
}
