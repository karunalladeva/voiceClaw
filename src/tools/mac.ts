import { defineTool } from '../runtime/tools';
import { z } from 'zod';
import { spawn, exec } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { ensureParentDir } from '../utils/workspace-dirs';

const WORKSPACE = path.join(process.cwd(), 'workspace');

// Helper to run shell commands easily
function runCommand(cmd: string, timeoutMs: number = 10000): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(`[Timed out after ${timeoutMs / 1000}s]`), timeoutMs);
    exec(cmd, { cwd: WORKSPACE }, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (error) {
        resolve(`Error: ${stderr || error.message}`);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Helper for osascript (AppleScript/JXA)
function runOsascript(script: string, timeoutMs: number = 10000, isJavaScript: boolean = false): Promise<string> {
  return new Promise((resolve) => {
    const args = isJavaScript ? ['-l', 'JavaScript', '-e', script] : ['-e', script];
    const proc = spawn('osascript', args, { cwd: WORKSPACE });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      resolve(`[Timed out after ${timeoutMs / 1000}s]`);
    }, timeoutMs);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && stderr) resolve(`Error: ${stderr.trim()}`);
      else resolve(stdout.trim() || 'Success');
    });
  });
}

export const macOpenAppTool = defineTool({
  name: 'mac_open_app',
    description: 'Open an application or URL on macOS (e.g. "Google Chrome", "Notes", "https://gmail.com").',
    schema: z.object({
      appName: z.string().describe('Name of the Mac app or a URL to open'),
    }),
  execute: async ({ appName }) => {
    // If it's an http/https URL, open will automatically use the default browser.
    const cmd = appName.startsWith('http') ? `open "${appName}"` : `open -a "${appName}"`;
    const res = await runCommand(cmd, 10000);
    return res.startsWith('Error') ? res : `Successfully launched ${appName}`;
  },
});

export const macTypeTool = defineTool({
  name: 'mac_type_text',
  description: 'Type plain text exactly as provided. Use this for typing emails, URLs, or messages.',
  schema: z.object({
    text: z.string().describe('The precise text to type'),
  }),
  execute: async ({ text }) => {
    // Escape quotes and backslashes for AppleScript
    const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "System Events" to keystroke "${escapedText}"`;
    return await runOsascript(script, 10000);
  },
});

export const macPressKeyTool = defineTool({
  name: 'mac_press_key',
  description: 'Simulate pressing a key or keyboard shortcut on macOS. Key can be a letter or special key (return, tab, space, delete, escape, up, down, left, right).',
  schema: z.object({
    key: z.string().describe('The key to press (e.g. "c", "v", "return", "tab")'),
    modifiers: z.array(z.enum(['command down', 'option down', 'control down', 'shift down'])).optional().describe('List of modifier keys to hold down'),
  }),
  execute: async ({ key, modifiers }) => {
    // Modifiers can be: command down, option down, control down, shift down
    let mods = '';
    if (modifiers && modifiers.length > 0) {
      mods = ` using {${modifiers.map(m => `"${m}"`).join(', ')}}`; // e.g. using {command down, shift down}
      // Actually AppleScript syntax for using is: using {command down, shift down} without quotes.
      mods = ` using {${modifiers.join(', ')}}`;
    }
    
    // Some special keys require 'key code' rather than 'keystroke'
    const specialKeys: Record<string, number> = {
      'return': 36, 'enter': 36, 'tab': 48, 'space': 49, 'delete': 51, 'escape': 53,
      'up': 126, 'down': 125, 'left': 123, 'right': 124
    };

    const isSpecial = specialKeys[key.toLowerCase()];
    const action = isSpecial !== undefined 
      ? `key code ${isSpecial}` 
      : `keystroke "${key}"`;

    const script = `tell application "System Events" to ${action}${mods}`;
    return await runOsascript(script, 5000);
  },
});

export const macTakeScreenshotTool = defineTool({
  name: 'mac_take_screenshot',
  description: 'Take a screenshot of the main Mac display and save it to the workspace directory.',
  schema: z.object({}),
  execute: async () => {
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(WORKSPACE, filename);
    const res = await runCommand(`screencapture -x "${filepath}"`, 15000);
    return res.startsWith('Error') ? res : `Screenshot saved to ${filepath}`;
  },
});

export const macGetActiveWindowTool = defineTool({
  name: 'mac_get_active_window',
  description: 'Get the name of the currently active app and its frontmost window title on macOS.',
  schema: z.object({}),
  execute: async () => {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        try
          set windowTitle to name of front window of frontApp
        on error
          set windowTitle to "(No Window)"
        end try
        return appName & " - " & windowTitle
      end tell
    `;
    return await runOsascript(script, 5000);
  },
});

export const macListDirectoryTool = defineTool({
  name: 'mac_list_directory',
  description: 'List all files and folders in a specific macOS directory (e.g. /Users/Name/Documents).',
  schema: z.object({
    dirPath: z.string().describe('Absolute path to the directory'),
  }),
  execute: async ({ dirPath }) => {
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      if (files.length === 0) return 'Directory is empty.';
      return files.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
    } catch (e: any) {
      return `Error listing directory: ${e.message}`;
    }
  },
});

export const macReadFileTool = defineTool({
  name: 'mac_read_file',
  description: 'Read the contents of any file on the Mac file system.',
  schema: z.object({
    filePath: z.string().describe('Absolute path to the file to read'),
  }),
  execute: async ({ filePath }) => {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (e: any) {
      return `Error reading file: ${e.message}`;
    }
  },
});

export const macWriteFileTool = defineTool({
  name: 'mac_write_file',
  description: 'Write text content to any file on the Mac file system.',
  schema: z.object({
    filePath: z.string().describe('Absolute path to the file to write'),
    content: z.string().describe('Text content to write into the file'),
  }),
  execute: async ({ filePath, content }) => {
    try {
      await ensureParentDir(filePath);
      await fs.writeFile(filePath, content, 'utf-8');
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (e: any) {
      return `Error writing file: ${e.message}`;
    }
  },
});

// Mac Mouse operations
// macOS doesn't easily expose mouse clicking/moving without Objective-C or CoreGraphics.
// We write a quick python script using PyObjC (often available) or fall back to AppleScript UI clicking if x,y isn't strict.
export const macMouseMoveTool = defineTool({
  name: 'mac_mouse_move',
  description: 'Move the mouse cursor to specific X and Y coordinates on macOS (Requires Python PyObjC OR cliclick installed).',
  schema: z.object({
    x: z.number().describe('X coordinate on screen'),
    y: z.number().describe('Y coordinate on screen'),
  }),
  execute: async ({ x, y }) => {
    const pythonScript = `
import sys
try:
    import Quartz
    event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (${x}, ${y}), 0)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
    print("Moved")
except ImportError:
    print("Error: Quartz (PyObjC) not found. On macOS, mouse cursor moving requires the 'pyobjc-core' and 'pyobjc-framework-Quartz' pip packages, or use of cliclick.")
    sys.exit(1)
`;
    // We execute the python via python3
    const proc = spawn('python3', ['-c', pythonScript]);
    return new Promise((resolve) => {
      let stderr = '';
      let stdout = '';
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', code => {
        if (code === 0) resolve(`Moved mouse to ${x}, ${y}`);
        else resolve(`Failed to move mouse. ${stderr.trim()} ${stdout.trim()}`);
      });
    });
  },
});

export const macMouseClickTool = defineTool({
  name: 'mac_mouse_click',
  description: 'Click the mouse at its current location on macOS.',
  schema: z.object({
    button: z.enum(['left', 'right']).optional().default('left').describe('Which button to click'),
    doubleClick: z.boolean().optional().default(false).describe('Whether to double click'),
    x: z.number().optional().describe('X coordinate to click (optional. If omitted, clicks current location)'),
    y: z.number().optional().describe('Y coordinate to click (optional)'),
  }),
  execute: async ({ button, doubleClick, x, y }) => {
    const clickType = button === 'right' ? 'Quartz.kCGMouseButtonRight' : 'Quartz.kCGMouseButtonLeft';
    const eventDown = button === 'right' ? 'Quartz.kCGEventRightMouseDown' : 'Quartz.kCGEventLeftMouseDown';
    const eventUp = button === 'right' ? 'Quartz.kCGEventRightMouseUp' : 'Quartz.kCGEventLeftMouseUp';
    
    const clickCountLine = doubleClick ? 'Quartz.CGEventSetIntegerValueField(eventDown, Quartz.kCGMouseEventClickState, 2)' : '';

    const hasCoords = x !== undefined && y !== undefined;

    const pythonScript = `
import sys
import time
try:
    import Quartz
    if ${hasCoords ? 'True' : 'False'}:
        loc = (${x || 0}, ${y || 0})
        moveEvt = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, loc, 0)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, moveEvt)
        time.sleep(0.05)
    else:
        dummy = Quartz.CGEventCreate(None)
        loc = Quartz.CGEventGetLocation(dummy)
    
    evtDown = Quartz.CGEventCreateMouseEvent(None, ${eventDown}, loc, ${clickType})
    ${clickCountLine}
    evtUp = Quartz.CGEventCreateMouseEvent(None, ${eventUp}, loc, ${clickType})
    
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, evtDown)
    time.sleep(0.05)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, evtUp)
    
    ${doubleClick ? `
    time.sleep(0.05)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, evtDown)
    time.sleep(0.05)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, evtUp)
    ` : ''}
    print("Clicked")
except ImportError:
    print("Error: Quartz (PyObjC) not found. Cannot perform raw mouse clicks.")
    sys.exit(1)
`;
    // We execute the python via python3
    const proc = spawn('python3', ['-c', pythonScript]);
    return new Promise((resolve) => {
      let stderr = '';
      let stdout = '';
      proc.stdout.on('data', d => stdout += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', code => {
        if (code === 0) resolve(`Clicked ${button} mouse button`);
        else resolve(`Failed to click mouse. ${stderr.trim()} ${stdout.trim()}`);
      });
    });
  },
});

export const allMacTools = [
  macOpenAppTool,
  macTypeTool,
  macPressKeyTool,
  macTakeScreenshotTool,
  macGetActiveWindowTool,
  macListDirectoryTool,
  macReadFileTool,
  macWriteFileTool,
  macMouseMoveTool,
  macMouseClickTool,
];
