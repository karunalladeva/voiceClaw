import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { HumanMessage } from '@langchain/core/messages';
import { modelRouter } from '../models/model-router';
import {
  ensureDir,
  ensureParentDir,
  OUTPUTS_SCREENSHOTS_DIR,
  OUTPUTS_TMP_DIR,
  WORKSPACE_ROOT,
} from '../utils/workspace-dirs';

const WORKSPACE = WORKSPACE_ROOT;
const SCREENSHOTS_DIR = OUTPUTS_SCREENSHOTS_DIR;
const TEMP_DIR = OUTPUTS_TMP_DIR;

// Helper to run PowerShell commands
function runPowerShell(script: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    // We use powershell.exe, but on modern systems pwsh is also available.
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: WORKSPACE,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill();
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve(`[Timed out after ${timeoutMs / 1000}s]`);
      } else if (code !== 0 && stderr) {
        resolve(`Error: ${stderr.trim()}`);
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve(`Error: ${err.message}`);
    });
  });
}

export const windowsOpenAppTool = tool(
  async ({ appName, args }) => {
    const argsPart = args ? `-ArgumentList "${args.replace(/"/g, '`"')}"` : '';
    const script = `
      try {
        Start-Process "${appName}" ${argsPart} -ErrorAction Stop
        Write-Output "Successfully launched ${appName}"
      } catch {
        Write-Output "Failed to launch ${appName}: $_"
      }
    `;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_open_app',
    description:
      'Open an application or file on Windows by executable name or full path. ' +
      'For opening URLs in a browser use windows_open_url instead.',
    schema: z.object({
      appName: z.string().describe('Executable name (e.g. notepad, calc, explorer) or full path to the exe'),
      args: z.string().optional().describe('Optional command-line arguments to pass to the application'),
    }),
  }
);

export const windowsOpenUrlTool = tool(
  async ({ url, browser, newTab }) => {
    const browserMap: Record<string, string> = {
      chrome: 'chrome.exe',
      firefox: 'firefox.exe',
      edge: 'msedge.exe',
      default: '',
    };
    const exe = browserMap[(browser || 'default').toLowerCase()] ?? '';

    let script: string;
    if (!exe) {
      const safeUrl = url.replace(/'/g, "''");
      script = `
        try {
          Start-Process '${safeUrl}'
          Write-Output "Opened ${url} in the default browser"
        } catch {
          Write-Output "Failed to open URL: $_"
        }
      `;
    } else {
      const tabFlag = newTab !== false ? '--new-tab' : '';
      const safeUrl = url.replace(/"/g, '`"');
      script = `
        try {
          $proc = Get-Process -Name '${exe.replace('.exe', '')}' -ErrorAction SilentlyContinue
          if ($proc) {
            Start-Process '${exe}' -ArgumentList '${tabFlag} "${safeUrl}"'
            Write-Output "Opened ${url} in a new ${browser} tab"
          } else {
            Start-Process '${exe}' -ArgumentList '"${safeUrl}"'
            Write-Output "Launched ${browser} and opened ${url}"
          }
        } catch {
          Start-Process '${exe}' -ArgumentList '"${safeUrl}"'
          Write-Output "Opened ${url} with ${browser}"
        }
      `;
    }
    return await runPowerShell(script, 15000);
  },
  {
    name: 'windows_open_url',
    description: 'Open a URL in a web browser on Windows.',
    schema: z.object({
      url: z.string().describe('The full URL to open'),
      browser: z.enum(['chrome', 'firefox', 'edge', 'default']).optional().default('default'),
      newTab: z.boolean().optional().default(true),
    }),
  }
);

export const windowsFocusWindowTool = tool(
  async ({ titleContains }) => {
    const safe = titleContains.replace(/'/g, "''");
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
          [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          public const int SW_RESTORE = 9;
        }
"@
      $target = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' } | Select-Object -First 1
      if ($target) {
        [Win32]::ShowWindow($target.MainWindowHandle, [Win32]::SW_RESTORE)
        [Win32]::SetForegroundWindow($target.MainWindowHandle)
        Write-Output "Focused window: $($target.MainWindowTitle)"
      } else {
        Write-Output "No window found with title containing '${safe}'"
      }
    `;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_focus_window',
    description: 'Bring an open window to the foreground.',
    schema: z.object({
      titleContains: z.string().describe('Partial window title to search for'),
    }),
  }
);

export const windowsPressKeyTool = tool(
  async ({ keys }) => {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${keys}')
      Write-Output "Sent keys: ${keys}"
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_press_key',
    description: 'Simulate pressing keys on the Windows keyboard.',
    schema: z.object({
      keys: z.string().describe('Key string to send (SendKeys format)'),
    }),
  }
);

export const windowsTakeScreenshotTool = tool(
  async () => {
    await ensureDir(SCREENSHOTS_DIR);
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    const script = `
      try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $Screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $Bitmap = New-Object System.Drawing.Bitmap $Screen.Width, $Screen.Height
        $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
        $Graphics.CopyFromScreen($Screen.X, $Screen.Y, 0, 0, $Bitmap.Size)
        $Bitmap.Save("${filepath}")
        $Graphics.Dispose()
        $Bitmap.Dispose()
        Write-Output "Screenshot saved to ${filepath}"
      } catch {
        Write-Output "Error taking screenshot: $_"
      }
    `;
    return await runPowerShell(script, 15000);
  },
  {
    name: 'windows_take_screenshot',
    description: 'Take a screenshot of the main Windows display. Saves to workspace/outputs/screenshots/.',
    schema: z.object({}),
  }
);


export const windowsReadScreenTool = tool(
  async ({ query, expectedFormat }) => {
    await ensureDir(TEMP_DIR);
    const filename = `read_screen_${Date.now()}.jpg`;
    const filepath = path.join(TEMP_DIR, filename);
    const script = `
      try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $Screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $Bitmap = New-Object System.Drawing.Bitmap $Screen.Width, $Screen.Height
        $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
        $Graphics.CopyFromScreen($Screen.X, $Screen.Y, 0, 0, $Bitmap.Size)
        $Bitmap.Save("${filepath}", [System.Drawing.Imaging.ImageFormat]::Jpeg)
        $Graphics.Dispose()
        $Bitmap.Dispose()
        Write-Output "OK"
      } catch {
        Write-Output "Error: $_"
      }
    `;
    const result = await runPowerShell(script, 15000);
    if (!result.includes('OK')) return `Screen capture failed: ${result}`;

    try {
      const buffer = await fs.readFile(filepath);
      const base64 = buffer.toString('base64');
      const visionModel = await modelRouter.getModel('vision');
      
      const baseQuery = query || "What is on my screen right now? Describe it in detail.";
      let formatInstruction = "";
      if (expectedFormat === 'json') {
        formatInstruction = " You MUST return ONLY valid JSON. The JSON must be an array of objects representing the interactive elements on screen. Each object MUST include 'type' (e.g. button, link, input), 'text' (the visible label), and 'position' (an object with estimated 'x' and 'y' pixel coordinates).";
      } else if (expectedFormat === 'html') {
        formatInstruction = " You MUST return ONLY valid HTML code reconstructing the semantic structure of the screen. For every interactive element (<button>, <a>, <input>), you MUST add a custom attribute 'data-pos=\"x,y\"' containing its estimated pixel coordinates.";
      } else if (expectedFormat === 'markdown') {
        formatInstruction = " You MUST return ONLY valid Markdown. Use formatting like lists or tables to represent the elements, and include estimated `[X, Y]` coordinates next to every interactive text, button, or link.";
      } else if (expectedFormat === 'xml') {
        formatInstruction = " You MUST return ONLY valid XML. Use a root <screen> tag containing <element> tags. Each <element> must have 'type', 'text', and 'x', 'y' coordinate attributes mapping the interactive items.";
      } else if (expectedFormat === 'summary') {
        formatInstruction = " Provide a brief, high-level summary of the screen state. Ignore exact coordinates and ignore minor details.";
      }

      const response = await visionModel.invoke([
        new HumanMessage({
          content: [
            { type: 'text', text: baseQuery + formatInstruction },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
          ]
        })
      ]);
      await fs.unlink(filepath).catch(() => {});
      return response.content.toString();
    } catch (e: any) {
      return `Vision interpretation failed: ${e.message}`;
    }
  },
  {
    name: 'windows_read_screen',
    description: 'Intercept and analyze the current Windows screen using Vision AI.',
    schema: z.object({
      query: z.string().optional().describe('Specific instruction (e.g. "Get exact X,Y coordinates of the Submit button")'),
      expectedFormat: z.enum(['text', 'json', 'html', 'markdown', 'xml', 'summary']).optional().default('text').describe('The desired output structure from the Vision AI.'),
    }),
  }
);

export const windowsGetActiveWindowTool = tool(
  async () => {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
        }
"@
      $hwnd = [Win32]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder 256
      if ([Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) -gt 0) {
        Write-Output $sb.ToString()
      } else {
        Write-Output "(No active window)"
      }
    `;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_get_active_window',
    description: 'Get the title of the foreground window.',
    schema: z.object({}),
  }
);

export const windowsTypeTool = tool(
  async ({ text }) => {
    // Correctly escape +, ^, %, ~, (, ), {, and } for SendKeys
    const escaped = text.replace(/([+^%~(){}\[\]])/g, '{$1}');
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
      Write-Output "Typed text"
    `;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_type_text',
    description: 'Type plain text exactly as provided. Safely escapes all special characters.',
    schema: z.object({ text: z.string() }),
  }
);

export const windowsMouseMoveTool = tool(
  async ({ x, y }) => {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Mouse {
          [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
        }
"@
      [Mouse]::SetCursorPos(${x}, ${y})
      Write-Output "Moved mouse to ${x}, ${y}"
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_mouse_move',
    description: 'Move mouse to X/Y coordinates.',
    schema: z.object({ x: z.number(), y: z.number() }),
  }
);

export const windowsMouseClickTool = tool(
  async ({ button, doubleClick, x, y, verifyVisualChange }) => {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Mouse {
          [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
          [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
          public const int LEFTDOWN = 0x02; public const int LEFTUP = 0x04;
          public const int RIGHTDOWN = 0x08; public const int RIGHTUP = 0x10;
        }
"@
      
      if ($${verifyVisualChange ? 'true' : 'false'}) {
        $hashCode = @"
          Add-Type -AssemblyName System.Drawing
          Add-Type -AssemblyName System.Windows.Forms
          function Get-ScreenHash {
            $Bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $Bmp = New-Object System.Drawing.Bitmap $Bounds.Width, $Bounds.Height
            $G = [System.Drawing.Graphics]::FromImage($Bmp)
            $G.CopyFromScreen($Bounds.X, $Bounds.Y, 0, 0, $Bmp.Size)
            $R = 0; $G_c = 0; $B_c = 0; $samples = 0
            for ($i = 0; $i -lt $Bmp.Width; $i += 100) {
              for ($j = 0; $j -lt $Bmp.Height; $j += 100) {
                $color = $Bmp.GetPixel($i, $j)
                $R += $color.R; $G_c += $color.G; $B_c += $color.B
                $samples++
              }
            }
            $G.Dispose(); $Bmp.Dispose()
            return "$([math]::Round($R/$samples))-$([math]::Round($G_c/$samples))-$([math]::Round($B_c/$samples))"
          }
"@
        Invoke-Expression $hashCode
        $hash1 = Get-ScreenHash
      }
      if ('${x}' -ne 'undefined' -and '${y}' -ne 'undefined') {
        [Mouse]::SetCursorPos(${x}, ${y})
        Start-Sleep -Milliseconds 50
      }
      $down = if ('${button}' -eq 'right') { [Mouse]::RIGHTDOWN } else { [Mouse]::LEFTDOWN }
      $up = if ('${button}' -eq 'right') { [Mouse]::RIGHTUP } else { [Mouse]::LEFTUP }
      [Mouse]::mouse_event($down, 0, 0, 0, 0)
      [Mouse]::mouse_event($up, 0, 0, 0, 0)
      if ($${doubleClick ? 'true' : 'false'}) {
        Start-Sleep -Milliseconds 50
        [Mouse]::mouse_event($down, 0, 0, 0, 0); [Mouse]::mouse_event($up, 0, 0, 0, 0)
      }
      
      if ($${verifyVisualChange ? 'true' : 'false'}) {
        Start-Sleep -Milliseconds 1500
        $hash2 = Get-ScreenHash
        if ($hash1 -eq $hash2) {
          Write-Output "Action_Failed: UI Static. Screen did not change after click. Try semantic search or recalculate coordinates."
          exit
        }
      }
      
      Write-Output "Clicked ${button}"
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_mouse_click',
    description: 'Click at a specific screen position (or current position if x/y omitted).',
    schema: z.object({ 
      button: z.enum(['left', 'right']).optional().default('left'), 
      doubleClick: z.boolean().optional().default(false),
      x: z.number().optional().describe('X coordinate to click on'),
      y: z.number().optional().describe('Y coordinate to click on'),
      verifyVisualChange: z.boolean().optional().default(false).describe('Set true to verify if UI changed after clicking. Returns Action_Failed if static.')
    }),
  }
);

export const windowsMousePositionTool = tool(
  async () => {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $pos = [System.Windows.Forms.Cursor]::Position
      Write-Output "X:$($pos.X), Y:$($pos.Y)"
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_get_mouse_position',
    description: 'Get current mouse position.',
    schema: z.object({}),
  }
);

export const windowsListDirectoryTool = tool(
  async ({ dirPath }) => {
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      return files.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n') || 'Empty.';
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  {
    name: 'windows_list_directory',
    description: 'List files in a directory.',
    schema: z.object({ dirPath: z.string() }),
  }
);

export const windowsReadFileTool = tool(
  async ({ filePath }) => {
    try { return await fs.readFile(filePath, 'utf-8'); }
    catch (e: any) { return `Error: ${e.message}`; }
  },
  {
    name: 'windows_read_file',
    description: 'Read a file.',
    schema: z.object({ filePath: z.string() }),
  }
);

export const windowsWriteFileTool = tool(
  async ({ filePath, content }) => {
    try {
      await ensureParentDir(filePath);
      await fs.writeFile(filePath, content, 'utf-8');
      return "Written.";
    }
    catch (e: any) { return `Error: ${e.message}`; }
  },
  {
    name: 'windows_write_file',
    description: 'Write to a file.',
    schema: z.object({ filePath: z.string(), content: z.string() }),
  }
);

export const windowsCheckProcessTool = tool(
  async ({ processName }) => {
    const script = `
      $p = Get-Process -Name "${processName}" -ErrorAction SilentlyContinue
      if ($p) { Write-Output (ConvertTo-Json @{ running=$true; processes=@($p | Select-Object Id, Name, MainWindowTitle) } -Compress) }
      else { Write-Output '{"running":false}' }
    `;
    return await runPowerShell(script, 8000);
  },
  {
    name: 'windows_check_process',
    description: 'Check if a process is running.',
    schema: z.object({ processName: z.string() }),
  }
);

export const windowsListWindowsTool = tool(
  async ({ filter }) => {
    const script = `
      $w = Get-Process | Where-Object { $_.MainWindowTitle -ne '' }
      if ("${filter}") { $w = $w | Where-Object { $_.MainWindowTitle -like '*${filter}*' } }
      Write-Output (ConvertTo-Json @($w | Select-Object Id, Name, @{n='title';e={$_.MainWindowTitle}}) -Compress)
    `;
    return await runPowerShell(script, 8000);
  },
  {
    name: 'windows_list_windows',
    description: 'List open windows.',
    schema: z.object({ filter: z.string().optional() }),
  }
);

export const windowsBrowserStatusTool = tool(
  async ({ browser }) => {
    const proc = browser === 'edge' ? 'msedge' : 'chrome';
    const script = `
      $p = Get-Process -Name "${proc}" -ErrorAction SilentlyContinue
      if (-not $p) { Write-Output '{"running":false}' }
      else { Write-Output '{"running":true, "tabs": []}' } # Simplified placeholder
    `;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_browser_status',
    description: 'Check browser status.',
    schema: z.object({ browser: z.enum(['chrome', 'edge']) }),
  }
);

export const windowsBrowserNavigateTool = tool(
  async ({ url, browser }) => {
    const exe = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
    const script = `Start-Process "${exe}" -ArgumentList "${url}"; Write-Output "Navigated."`;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_browser_navigate',
    description: 'Navigate to a URL.',
    schema: z.object({ url: z.string(), browser: z.enum(['chrome', 'edge']) }),
  }
);

export const windowsFindAppTool = tool(
  async ({ name }) => {
    const script = `Get-StartApps | Where-Object { $_.Name -like "*${name}*" } | Select-Object Name, AppID | ConvertTo-Json -Compress`;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_find_app',
    description: 'Find an app by name.',
    schema: z.object({ name: z.string() }),
  }
);

export const windowsListAppsTool = tool(
  async ({ filter }) => {
    const script = `Get-StartApps | Where-Object { $_.Name -like "*${filter}*" } | Select-Object Name | ConvertTo-Json -Compress`;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_list_apps',
    description: 'List installed apps.',
    schema: z.object({ filter: z.string().optional() }),
  }
);

export const windowsSmartOpenTool = tool(
  async ({ name }) => {
    const script = `
      $app = Get-StartApps | Where-Object { $_.Name -like "*${name}*" } | Select-Object -First 1
      if ($app) { Start-Process "shell:AppsFolder\\$($app.AppID)"; Write-Output "Opened $($app.Name)" }
      else { Write-Output "Not found." }
    `;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_smart_open',
    description: 'Intelligently open an app by name.',
    schema: z.object({ name: z.string() }),
  }
);

export const windowsSemanticSearchTool = tool(
  async ({ elementName }) => {
    const script = `
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $desktop = [System.Windows.Automation.AutomationElement]::RootElement
      $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "${elementName}")
      $element = $desktop.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
      if ($element) {
        $rect = $element.Current.BoundingRectangle
        if ($rect.IsEmpty -eq $false) {
            $x = [math]::Round($rect.Left + ($rect.Width / 2))
            $y = [math]::Round($rect.Top + ($rect.Height / 2))
            Write-Output "Found '${elementName}' at X:$x, Y:$y"
        } else {
            Write-Output "Found '${elementName}' but it has no visible bounds."
        }
      } else {
        Write-Output "Element '${elementName}' not found in UI tree. Fallback to windows_read_screen."
      }
    `;
    return await runPowerShell(script, 15000);
  },
  {
    name: 'windows_semantic_search',
    description: 'Fallback search: Query the Windows UI tree directly for an exact element Name/Label to get valid X,Y coordinates. Use if vision clicks fail.',
    schema: z.object({ elementName: z.string().describe('Exact or partial name of the UI element') }),
  }
);

export const windowsJanitorTool = tool(
  async () => {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('%{F4}')
      Write-Output "Executed Alt+F4 to close the active window obstruction."
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_close_obstruction',
    description: 'The Janitor Protocol: Close an unexpected or obstructive pop-up/window by sending Alt+F4.',
    schema: z.object({}),
  }
);

export const allWindowsTools: any[] = [
  windowsOpenAppTool,
  windowsOpenUrlTool,
  windowsFocusWindowTool,
  windowsPressKeyTool,
  windowsTakeScreenshotTool,
  windowsReadScreenTool,
  windowsGetActiveWindowTool,
  windowsTypeTool,
  windowsMouseMoveTool,
  windowsMouseClickTool,
  windowsMousePositionTool,
  windowsListDirectoryTool,
  windowsReadFileTool,
  windowsWriteFileTool,
  windowsCheckProcessTool,
  windowsListWindowsTool,
  windowsBrowserStatusTool,
  windowsBrowserNavigateTool,
  windowsFindAppTool,
  windowsListAppsTool,
  windowsSmartOpenTool,
  windowsSemanticSearchTool,
  windowsJanitorTool,
];
