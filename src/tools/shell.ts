import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';

const WORKSPACE = path.join(process.cwd(), 'workspace');

const BLOCKED_PATTERNS = [
  /rm\s+(-rf?|--no-preserve-root)\s+\//i,
  /mkfs/i,
  /dd\s+.*of=\/dev/i,
  /:(){ :\|:& };:/,
  /format\s+[a-z]:/i,
  /del\s+\/[sfq]\s+/i,
];

function isBlocked(cmd: string): boolean {
  return BLOCKED_PATTERNS.some(p => p.test(cmd));
}

function runCommand(command: string, workdir: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const isWin = os.platform() === 'win32';
    const shell = isWin ? 'cmd.exe' : (process.env.SHELL || '/bin/sh');
    const shellArgs = isWin ? ['/c', command] : ['-c', command];

    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(shell, shellArgs, {
      cwd: workdir,
      env: { ...process.env },
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Cap output to prevent memory issues
      if (stdout.length > 50000) {
        stdout = stdout.substring(0, 50000) + '\n... (output truncated)';
        proc.kill('SIGTERM');
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 20000) {
        stderr = stderr.substring(0, 20000) + '\n... (stderr truncated)';
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: killed ? -1 : (code ?? 1),
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    });
  });
}

export const shellExecTool = tool(
  async ({ command, workdir, timeout }) => {
    console.log(`[Tool: Shell] Executing: "${command}" in ${workdir || WORKSPACE}`);

    if (isBlocked(command)) {
      return 'BLOCKED: This command is not allowed for safety reasons.';
    }

    const cwd = workdir || WORKSPACE;
    const timeoutMs = (timeout || 30) * 1000;

    const result = await runCommand(command, cwd, timeoutMs);

    let output = '';
    if (result.exitCode === -1) {
      output += `[Timed out after ${timeout || 30}s]\n`;
    }
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += `\n[stderr]: ${result.stderr}`;
    if (!output.trim()) output = `(no output, exit code: ${result.exitCode})`;

    output += `\n[exit code: ${result.exitCode}]`;

    return output;
  },
  {
    name: 'shell_exec',
    description:
      'Execute a shell command on the local machine. Use for running scripts, ' +
      'checking system info, installing packages, git operations, file management, etc. ' +
      'Commands run in the workspace directory by default.',
    schema: z.object({
      command: z.string().describe('The shell command to execute'),
      workdir: z.string().optional().describe('Working directory (defaults to workspace)'),
      timeout: z.number().optional().describe('Timeout in seconds (default 30, max 300)'),
    }),
  }
);
