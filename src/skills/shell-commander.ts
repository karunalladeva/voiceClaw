import { BaseSkill, SkillDefinition } from './base-skill';
import { shellExecTool } from '../tools/shell';

export default class ShellSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: 'shell',
      name: 'Shell Commander',
      description: 'Executes shell commands, scripts, and system operations on the local machine.',
      triggerDescription:
        'Use when the user asks to run a command, execute a script, check system info, ' +
        'install packages, use git, manage processes, or perform any terminal/command-line operation.',
      systemPrompt:
        'You are a shell command execution specialist. You can run any shell command on the user\'s machine. ' +
        'Use the shell_exec tool to execute commands. Always explain what you\'re about to run before executing. ' +
        'If a command could be destructive (delete files, modify system settings), warn the user first. ' +
        'Report the output clearly. Your response will be spoken aloud, so summarize the results concisely. ' +
        'On Windows, use cmd/powershell syntax. On Linux/macOS, use bash syntax.',
      tools: [shellExecTool],
      enabled: true,
    };
  }
}
