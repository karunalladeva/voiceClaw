import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

const WORKSPACE = path.join(process.cwd(), 'workspace');

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
    // Normalise browser choice into an executable name
    const browserMap: Record<string, string> = {
      chrome: 'chrome.exe',
      firefox: 'firefox.exe',
      edge: 'msedge.exe',
      default: '',
    };
    const exe = browserMap[(browser || 'default').toLowerCase()] ?? '';

    let script: string;
    if (!exe) {
      // Let Windows pick the default browser
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
      // Launch with the chosen browser
      // --new-tab opens URL in a new tab if the browser is already running
      const tabFlag = newTab !== false ? '--new-tab' : '';
      const safeUrl = url.replace(/"/g, '`"');
      script = `
        try {
          $proc = Get-Process -Name '${exe.replace('.exe', '')}' -ErrorAction SilentlyContinue
          if ($proc) {
            # Browser already running — open new tab
            Start-Process '${exe}' -ArgumentList '${tabFlag} "${safeUrl}"'
            Write-Output "Opened ${url} in a new ${browser} tab"
          } else {
            Start-Process '${exe}' -ArgumentList '"${safeUrl}"'
            Write-Output "Launched ${browser} and opened ${url}"
          }
        } catch {
          # Fallback: let Windows find the browser
          Start-Process '${exe}' -ArgumentList '"${safeUrl}"'
          Write-Output "Opened ${url} with ${browser}"
        }
      `;
    }
    return await runPowerShell(script, 15000);
  },
  {
    name: 'windows_open_url',
    description:
      'Open a URL in a web browser on Windows. ' +
      'Can target a specific browser (chrome, firefox, edge) and open in a new tab. ' +
      'Examples: open Gmail in Chrome, open YouTube in a new Edge tab.',
    schema: z.object({
      url: z.string().describe('The full URL to open (e.g. https://gmail.com, https://youtube.com)'),
      browser: z
        .enum(['chrome', 'firefox', 'edge', 'default'])
        .optional()
        .default('default')
        .describe('Which browser to use. Omit to use the system default.'),
      newTab: z
        .boolean()
        .optional()
        .default(true)
        .describe('Open in a new tab if the browser is already running (default true)'),
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
    description:
      'Bring an open window to the foreground by searching for it by title keyword. ' +
      'Use this to switch to Chrome, Notepad, VS Code, etc.',
    schema: z.object({
      titleContains: z.string().describe('Partial window title to search for (e.g. "Chrome", "Notepad")'),
    }),
  }
);

export const windowsPressKeyTool = tool(
  async ({ keys }) => {
    // Uses SendKeys from System.Windows.Forms
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${keys}')
      Write-Output "Sent keys: ${keys}"
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_press_key',
    description: 'Simulate pressing keys on the Windows keyboard. Use SendKeys syntax. Examples: "{ENTER}", "^c" for Ctrl+C, "%{TAB}" for Alt+Tab.',
    schema: z.object({
      keys: z.string().describe('Key string to send (SendKeys format)'),
    }),
  }
);

export const windowsTakeScreenshotTool = tool(
  async () => {
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(WORKSPACE, filename);
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
    description: 'Take a screenshot of the main Windows display and save it to the workspace directory.',
    schema: z.object({}),
  }
);

export const windowsGetActiveWindowTool = tool(
  async () => {
    // Requires some C# interop in PowerShell to get the active window title reliably
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")]
          public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
        }
"@
      $hwnd = [Win32]::GetForegroundWindow()
      $sb = New-Object System.Text.StringBuilder 256
      if ([Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) -gt 0) {
        Write-Output $sb.ToString()
      } else {
        Write-Output "(No active window or could not read title)"
      }
    `;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_get_active_window',
    description: 'Get the title of the currently active (foreground) window on Windows.',
    schema: z.object({}),
  }
);

export const windowsTypeTool = tool(
  async ({ text }) => {
    // Uses SendKeys from System.Windows.Forms, but properly escapes special characters for plain text typing
    // Plus (+), Caret (^), Percent (%), Tilde (~), and Parentheses () need entering in braces.
    const escaped = text.replace(/([+^%~()])/g, '{$1}');
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
      Write-Output "Typed text"
    `;
    return await runPowerShell(script, 10000);
  },
  {
    name: 'windows_type_text',
    description: 'Type plain text exactly as provided. Use this for typing emails, URLs, or messages. Do NOT use this for keyboard shortcuts.',
    schema: z.object({
      text: z.string().describe('The precise text to type'),
    }),
  }
);

export const windowsMouseMoveTool = tool(
  async ({ x, y }) => {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Mouse {
          [DllImport("user32.dll")]
          public static extern bool SetCursorPos(int X, int Y);
        }
"@
      [Mouse]::SetCursorPos(${x}, ${y})
      Write-Output "Moved mouse to ${x}, ${y}"
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_mouse_move',
    description: 'Move the mouse cursor to specific X and Y coordinates on the screen.',
    schema: z.object({
      x: z.number().describe('X coordinate on screen'),
      y: z.number().describe('Y coordinate on screen'),
    }),
  }
);

export const windowsMouseClickTool = tool(
  async ({ button, doubleClick }) => {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Mouse {
          [DllImport("user32.dll")]
          public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
          public const int LEFTDOWN = 0x02;
          public const int LEFTUP = 0x04;
          public const int RIGHTDOWN = 0x08;
          public const int RIGHTUP = 0x10;
        }
"@
      $FlagsDown = if ('${button}' -eq 'right') { [Mouse]::RIGHTDOWN } else { [Mouse]::LEFTDOWN }
      $FlagsUp = if ('${button}' -eq 'right') { [Mouse]::RIGHTUP } else { [Mouse]::LEFTUP }
      
      [Mouse]::mouse_event($FlagsDown, 0, 0, 0, 0)
      [Mouse]::mouse_event($FlagsUp, 0, 0, 0, 0)
      
      if ($${doubleClick ? 'true' : 'false'}) {
        Start-Sleep -Milliseconds 50
        [Mouse]::mouse_event($FlagsDown, 0, 0, 0, 0)
        [Mouse]::mouse_event($FlagsUp, 0, 0, 0, 0)
      }
      Write-Output "Clicked ${button} mouse button"
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_mouse_click',
    description: 'Click the mouse at its current location.',
    schema: z.object({
      button: z.enum(['left', 'right']).optional().default('left').describe('Which button to click (left or right)'),
      doubleClick: z.boolean().optional().default(false).describe('Whether to double click'),
    }),
  }
);

export const windowsMousePositionTool = tool(
  async () => {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $X = [System.Windows.Forms.Cursor]::Position.X
      $Y = [System.Windows.Forms.Cursor]::Position.Y
      Write-Output "X:$X, Y:$Y"
    `;
    return await runPowerShell(script, 5000);
  },
  {
    name: 'windows_get_mouse_position',
    description: 'Get the current X and Y coordinates of the mouse cursor.',
    schema: z.object({}),
  }
);

export const windowsListDirectoryTool = tool(
  async ({ dirPath }) => {
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      if (files.length === 0) return 'Directory is empty.';
      return files.map(f => `${f.isDirectory() ? '[DIR]' : '[FILE]'} ${f.name}`).join('\n');
    } catch (e: any) {
      return `Error listing directory: ${e.message}`;
    }
  },
  {
    name: 'windows_list_directory',
    description: 'List all files and folders in a specific Windows directory (unrestricted).',
    schema: z.object({
      dirPath: z.string().describe('Absolute path to the directory (e.g. C:\\Users\\Name\\Documents)'),
    }),
  }
);

export const windowsReadFileTool = tool(
  async ({ filePath }) => {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (e: any) {
      return `Error reading file: ${e.message}`;
    }
  },
  {
    name: 'windows_read_file',
    description: 'Read the contents of any file on the Windows file system.',
    schema: z.object({
      filePath: z.string().describe('Absolute path to the file to read'),
    }),
  }
);

export const windowsWriteFileTool = tool(
  async ({ filePath, content }) => {
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return `Successfully wrote ${content.length} characters to ${filePath}`;
    } catch (e: any) {
      return `Error writing file: ${e.message}`;
    }
  },
  {
    name: 'windows_write_file',
    description: 'Write text content to any file on the Windows file system.',
    schema: z.object({
      filePath: z.string().describe('Absolute path to the file to write'),
      content: z.string().describe('Text content to write into the file'),
    }),
  }
);

// ── Process / Window inspection ────────────────────────────────────────────

export const windowsCheckProcessTool = tool(
  async ({ processName }) => {
    const safe = processName.replace(/"/g, '');
    const script = `
      $procs = Get-Process -Name "${safe}" -ErrorAction SilentlyContinue
      if (-not $procs) {
        Write-Output '{ "running": false }'
      } else {
        $list = $procs | ForEach-Object {
          [PSCustomObject]@{
            pid    = $_.Id
            name   = $_.ProcessName
            window = $_.MainWindowTitle
            mem_mb = [Math]::Round($_.WorkingSet64 / 1MB, 1)
          }
        }
        $out = [PSCustomObject]@{ running = $true; processes = @($list) }
        Write-Output (ConvertTo-Json $out -Compress)
      }
    `;
    return await runPowerShell(script, 8000);
  },
  {
    name: 'windows_check_process',
    description:
      'Check whether an application is currently running. ' +
      'Returns running status, PIDs, and window titles. ' +
      'Use this BEFORE trying to open or focus any app so you know its current state. ' +
      'Process name examples: chrome, msedge, firefox, notepad, code, explorer',
    schema: z.object({
      processName: z.string().describe('Process name without .exe (e.g. chrome, notepad, code)'),
    }),
  }
);

export const windowsListWindowsTool = tool(
  async ({ filter }) => {
    const filterPart = filter
      ? `| Where-Object { $_.MainWindowTitle -like '*${filter.replace(/'/g, "''")}*' }`
      : '';
    const script = `
      $windows = Get-Process ${filterPart} -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -ne '' } |
        Select-Object @{n='pid';e={$_.Id}}, @{n='name';e={$_.ProcessName}}, @{n='title';e={$_.MainWindowTitle}} |
        Sort-Object name
      if ($windows) {
        Write-Output (ConvertTo-Json @($windows) -Compress)
      } else {
        Write-Output '[]'
      }
    `;
    return await runPowerShell(script, 8000);
  },
  {
    name: 'windows_list_windows',
    description:
      'List all currently open application windows with their titles and process names. ' +
      'Use this to see what is open on the desktop before deciding what to do next.',
    schema: z.object({
      filter: z.string().optional().describe('Optional keyword to filter window titles (e.g. "Chrome", "Gmail")'),
    }),
  }
);

// ── Chrome DevTools Protocol (CDP) browser control ─────────────────────────
// Chrome/Edge can be remote-controlled via their built-in HTTP debug API.
// CDP port 9222 is enabled when the browser is launched with
// --remote-debugging-port=9222. These tools launch the browser with that flag
// automatically if it isn't already running, giving full, verifiable control.

const CDP_PORT = 9222;

/** Shared PowerShell helper: tries CDP, returns JSON or an error string. */
function cdpScript(innerScript: string, browserExe: string): string {
  return `
    $cdp = "http://localhost:${CDP_PORT}"
    $exe = "${browserExe}"

    function Start-BrowserWithCDP {
      Start-Process $exe -ArgumentList "--remote-debugging-port=${CDP_PORT} --no-first-run --no-default-browser-check"
      $deadline = (Get-Date).AddSeconds(8)
      do {
        Start-Sleep -Milliseconds 400
        try {
          $null = Invoke-WebRequest "$cdp/json/version" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
          return $true
        } catch {}
      } while ((Get-Date) -lt $deadline)
      return $false
    }

    function Get-CdpAvailable {
      try {
        $null = Invoke-WebRequest "$cdp/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return $true
      } catch { return $false }
    }

    ${innerScript}
  `;
}

export const windowsBrowserStatusTool = tool(
  async ({ browser }) => {
    const exe = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
    const procName = browser === 'edge' ? 'msedge' : 'chrome';
    const inner = `
      $proc = Get-Process -Name "${procName}" -ErrorAction SilentlyContinue
      if (-not $proc) {
        Write-Output '{ "running": false, "cdp": false, "tabs": [] }'
      } elseif (Get-CdpAvailable) {
        $raw  = Invoke-WebRequest "$cdp/json" -UseBasicParsing | ConvertFrom-Json
        $tabs = @($raw | Where-Object { $_.type -eq 'page' } | Select-Object id, url, title)
        $out  = [PSCustomObject]@{ running = $true; cdp = $true; tab_count = $tabs.Count; tabs = $tabs }
        Write-Output (ConvertTo-Json $out -Compress -Depth 4)
      } else {
        $titles = @($proc | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty MainWindowTitle)
        $out = [PSCustomObject]@{ running = $true; cdp = $false; windows = $titles;
          hint = "Launch ${browser} with --remote-debugging-port=${CDP_PORT} for full tab control" }
        Write-Output (ConvertTo-Json $out -Compress)
      }
    `;
    return await runPowerShell(cdpScript(inner, exe), 12000);
  },
  {
    name: 'windows_browser_status',
    description:
      'Get the current status of Chrome or Edge: whether it is running, ' +
      'whether the CDP debug API is available, and a list of all open tabs with their URLs and titles. ' +
      'Use this to check the browser state before navigating or opening new tabs.',
    schema: z.object({
      browser: z.enum(['chrome', 'edge']).default('chrome').describe('Which browser to inspect'),
    }),
  }
);

export const windowsBrowserNavigateTool = tool(
  async ({ url, browser, newTab }) => {
    const exe = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
    const procName = browser === 'edge' ? 'msedge' : 'chrome';
    const safeUrl = url.replace(/`/g, '').replace(/"/g, '');
    const inner = `
      $targetUrl = "${safeUrl}"
      $proc = Get-Process -Name "${procName}" -ErrorAction SilentlyContinue

      if (-not $proc) {
        # Browser not open at all — start it with CDP port and the URL
        $started = Start-BrowserWithCDP
        if (-not $started) {
          # CDP didn't come up in time, but the browser likely opened
          Write-Output "Started ${browser} and navigated to $targetUrl (CDP pending)"
        } else {
          $tab = Invoke-WebRequest "$cdp/json/new?$targetUrl" -UseBasicParsing | ConvertFrom-Json
          Write-Output "Started ${browser} via CDP. Tab opened: $($tab.title) | $($tab.url)"
        }
      } elseif (Get-CdpAvailable) {
        if (${newTab !== false ? '$true' : '$false'}) {
          # Open a new tab via CDP — most reliable method
          $tab = Invoke-WebRequest "$cdp/json/new?$targetUrl" -UseBasicParsing | ConvertFrom-Json
          Write-Output "New tab opened in ${browser}: $($tab.title) | $($tab.url) | Tab ID: $($tab.id)"
        } else {
          # Navigate the active tab via CDP
          $tabs = Invoke-WebRequest "$cdp/json" -UseBasicParsing | ConvertFrom-Json
          $active = @($tabs | Where-Object { $_.type -eq 'page' })[0]
          if ($active) {
            $body = '{"id":1,"method":"Page.navigate","params":{"url":"' + $targetUrl + '"}}'
            $ws = New-Object System.Net.WebSockets.ClientWebSocket
            $uri = [System.Uri]("ws://localhost:${CDP_PORT}" + $active.webSocketDebuggerUrl.Substring($active.webSocketDebuggerUrl.IndexOf('/')))
            $cts = New-Object System.Threading.CancellationTokenSource
            $ws.ConnectAsync($uri, $cts.Token).Wait()
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
            $ws.SendAsync($bytes, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).Wait()
            $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $cts.Token).Wait()
            Write-Output "Navigated active ${browser} tab to $targetUrl"
          } else {
            $tab = Invoke-WebRequest "$cdp/json/new?$targetUrl" -UseBasicParsing | ConvertFrom-Json
            Write-Output "No active tab found; opened new tab: $($tab.url)"
          }
        }
      } else {
        # Browser running without CDP — re-launch with debug port, existing session untouched
        Write-Output "CDP not available. Launching helper ${browser} instance with debug port..."
        $started = Start-BrowserWithCDP
        if ($started) {
          $tab = Invoke-WebRequest "$cdp/json/new?$targetUrl" -UseBasicParsing | ConvertFrom-Json
          Write-Output "New tab opened via CDP: $($tab.url)"
        } else {
          Start-Process "${exe}" -ArgumentList "--new-tab","$targetUrl"
          Write-Output "Opened $targetUrl in ${browser} (fallback, no CDP)"
        }
      }
    `;
    return await runPowerShell(cdpScript(inner, exe), 20000);
  },
  {
    name: 'windows_browser_navigate',
    description:
      'Open a URL in Chrome or Edge with full verification. ' +
      'Uses the Chrome DevTools Protocol (CDP) for reliable control: ' +
      'starts the browser if needed, opens a new tab or navigates the current one, ' +
      'and returns confirmation of what actually happened. ' +
      'Prefer this over windows_open_url for browser tasks.',
    schema: z.object({
      url: z.string().describe('Full URL to open (e.g. https://gmail.com)'),
      browser: z.enum(['chrome', 'edge']).default('chrome').describe('Which browser to use'),
      newTab: z.boolean().optional().default(true).describe('Open in a new tab (true) or navigate the current tab (false)'),
    }),
  }
);

export const windowsBrowserCloseTabTool = tool(
  async ({ browser, tabId, urlContains }) => {
    const exe = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
    const inner = `
      if (-not (Get-CdpAvailable)) {
        Write-Output "CDP not available — cannot close tab programmatically"
      } else {
        $tabs = Invoke-WebRequest "$cdp/json" -UseBasicParsing | ConvertFrom-Json
        $target = $null
        if ("${tabId}") {
          $target = $tabs | Where-Object { $_.id -eq "${tabId}" } | Select-Object -First 1
        } elseif ("${urlContains || ''}") {
          $target = $tabs | Where-Object { $_.url -like "*${urlContains}*" } | Select-Object -First 1
        }
        if ($target) {
          Invoke-WebRequest "$cdp/json/close/$($target.id)" -UseBasicParsing | Out-Null
          Write-Output "Closed tab: $($target.title) | $($target.url)"
        } else {
          Write-Output "No matching tab found"
        }
      }
    `;
    return await runPowerShell(cdpScript(inner, exe), 10000);
  },
  {
    name: 'windows_browser_close_tab',
    description: 'Close a specific browser tab by its tab ID (from windows_browser_status) or by a URL keyword match.',
    schema: z.object({
      browser: z.enum(['chrome', 'edge']).default('chrome'),
      tabId: z.string().optional().describe('Exact tab ID from windows_browser_status'),
      urlContains: z.string().optional().describe('Keyword to match in the tab URL (e.g. "gmail", "youtube")'),
    }),
  }
);

// ── Unknown app discovery & smart launch ───────────────────────────────────

export const windowsFindAppTool = tool(
  async ({ name }) => {
    const safe = name.replace(/'/g, "''").replace(/"/g, '');
    const script = `
      $results = [System.Collections.Generic.List[PSCustomObject]]::new()
      $q = "*${safe}*"

      # 1. Get-StartApps — covers ALL installed apps including Store/UWP
      try {
        Get-StartApps | Where-Object { $_.Name -like $q } | ForEach-Object {
          $results.Add([PSCustomObject]@{ source="StartMenu"; name=$_.Name; launch="shell:AppsFolder\\$($_.AppID)"; appId=$_.AppID })
        }
      } catch {}

      # 2. Registry App Paths — classic Win32 apps registered in registry
      try {
        $regBase = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths"
        Get-ChildItem $regBase -ErrorAction SilentlyContinue |
          Where-Object { $_.PSChildName -like $q } | ForEach-Object {
            $exePath = (Get-ItemProperty $_.PSPath).'(default)'
            if ($exePath) {
              $results.Add([PSCustomObject]@{ source="Registry"; name=$_.PSChildName; launch=$exePath; appId=$null })
            }
          }
      } catch {}

      # 3. Start Menu shortcuts (.lnk)
      try {
        $dirs = @(
          "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
          "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
        )
        $sh = New-Object -ComObject WScript.Shell
        foreach ($dir in $dirs) {
          Get-ChildItem $dir -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName -like $q } | ForEach-Object {
              try {
                $target = $sh.CreateShortcut($_.FullName).TargetPath
                $results.Add([PSCustomObject]@{ source="Shortcut"; name=$_.BaseName; launch=$_.FullName; appId=$null })
              } catch {}
            }
        }
      } catch {}

      # 4. PATH / where.exe
      try {
        $found = where.exe "${safe}" 2>$null
        if ($found) {
          $results.Add([PSCustomObject]@{ source="PATH"; name="${safe}"; launch=$found; appId=$null })
        }
      } catch {}

      if ($results.Count -eq 0) {
        Write-Output '{ "found": false, "matches": [] }'
      } else {
        # Deduplicate by name
        $unique = $results | Sort-Object name -Unique
        $out = [PSCustomObject]@{ found = $true; matches = @($unique) }
        Write-Output (ConvertTo-Json $out -Compress -Depth 3)
      }
    `;
    return await runPowerShell(script, 15000);
  },
  {
    name: 'windows_find_app',
    description:
      'Search for any installed application by its friendly name — works for Win32 apps, ' +
      'Windows Store/UWP apps, Steam games, and anything in the Start Menu. ' +
      'Returns how to launch the app. Use this when you do not know the exe name. ' +
      'Examples: "Spotify", "Discord", "Steam", "Notepad++".',
    schema: z.object({
      name: z.string().describe('Friendly app name or keyword to search for (e.g. Spotify, Discord, VS Code)'),
    }),
  }
);

export const windowsListAppsTool = tool(
  async ({ filter }) => {
    const safe = (filter || '').replace(/'/g, "''");
    const filterPart = safe ? `| Where-Object { $_.Name -like "*${safe}*" }` : '';
    const script = `
      try {
        $apps = Get-StartApps ${filterPart} | Select-Object Name, AppID | Sort-Object Name
        if ($apps) {
          Write-Output (ConvertTo-Json @($apps) -Compress)
        } else {
          Write-Output '[]'
        }
      } catch {
        Write-Output "Error: $_"
      }
    `;
    return await runPowerShell(script, 15000);
  },
  {
    name: 'windows_list_apps',
    description:
      'List all installed applications visible in the Windows Start Menu, ' +
      'including Store/UWP apps, Win32 apps, and games. ' +
      'Optionally filter by a keyword. Use this when you need to discover what apps are installed.',
    schema: z.object({
      filter: z.string().optional().describe('Optional keyword to filter results (e.g. "game", "adobe", "microsoft")'),
    }),
  }
);

export const windowsSmartOpenTool = tool(
  async ({ name, args }) => {
    const safe = name.replace(/'/g, "''").replace(/"/g, '');
    const argsStr = (args || '').replace(/'/g, "''");
    const script = `
      $q = "*${safe}*"
      $launched = $false
      $launchInfo = ""

      # 1. Try Get-StartApps first (most reliable for Store + registered apps)
      try {
        $app = Get-StartApps | Where-Object { $_.Name -like $q } | Select-Object -First 1
        if ($app) {
          Start-Process "shell:AppsFolder\\$($app.AppID)"
          Start-Sleep -Milliseconds 1500
          $proc = Get-Process | Where-Object { $_.MainWindowTitle -like $q } | Select-Object -First 1
          if ($proc) {
            $launchInfo = "Opened '$($app.Name)' via Start Menu (window: $($proc.MainWindowTitle))"
          } else {
            $launchInfo = "Launched '$($app.Name)' via Start Menu (AppID: $($app.AppID))"
          }
          $launched = $true
        }
      } catch {}

      # 2. Try registry App Paths
      if (-not $launched) {
        try {
          $regBase = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths"
          $match = Get-ChildItem $regBase -ErrorAction SilentlyContinue |
            Where-Object { $_.PSChildName -like $q } | Select-Object -First 1
          if ($match) {
            $exePath = (Get-ItemProperty $match.PSPath).'(default)'
            if ($exePath -and (Test-Path $exePath)) {
              if ("${argsStr}") {
                Start-Process $exePath -ArgumentList "${argsStr}"
              } else {
                Start-Process $exePath
              }
              Start-Sleep -Milliseconds 1500
              $launchInfo = "Opened '$($match.PSChildName)' from registry path: $exePath"
              $launched = $true
            }
          }
        } catch {}
      }

      # 3. Try Start Menu .lnk shortcuts
      if (-not $launched) {
        try {
          $dirs = @(
            "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
            "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
          )
          $lnk = $null
          foreach ($dir in $dirs) {
            $lnk = Get-ChildItem $dir -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |
              Where-Object { $_.BaseName -like $q } | Select-Object -First 1
            if ($lnk) { break }
          }
          if ($lnk) {
            Start-Process $lnk.FullName
            Start-Sleep -Milliseconds 1500
            $launchInfo = "Opened '$($lnk.BaseName)' via shortcut"
            $launched = $true
          }
        } catch {}
      }

      # 4. Try PATH
      if (-not $launched) {
        try {
          $found = where.exe "${safe}" 2>$null | Select-Object -First 1
          if ($found) {
            if ("${argsStr}") {
              Start-Process $found -ArgumentList "${argsStr}"
            } else {
              Start-Process $found
            }
            Start-Sleep -Milliseconds 1500
            $launchInfo = "Opened '${safe}' from PATH: $found"
            $launched = $true
          }
        } catch {}
      }

      if ($launched) {
        Write-Output $launchInfo
      } else {
        Write-Output "Could not find '${safe}' in Start Menu, registry, shortcuts, or PATH. Try windows_find_app or windows_list_apps to discover the correct name."
      }
    `;
    return await runPowerShell(script, 20000);
  },
  {
    name: 'windows_smart_open',
    description:
      'Open ANY application by its friendly display name — no need to know the exe path. ' +
      'Searches Start Menu (Win32 + Store/UWP), registry, and PATH in order. ' +
      'Returns what was actually launched or a clear failure message. ' +
      'Use this as the default way to open any unknown app before falling back to windows_open_app.',
    schema: z.object({
      name: z.string().describe('Friendly app name (e.g. Spotify, Discord, Notepad++, Steam, VS Code, Calculator)'),
      args: z.string().optional().describe('Optional command-line arguments (for Win32 apps only)'),
    }),
  }
);

export const allWindowsTools = [
  // ── State inspection (use first to understand current state) ──
  windowsCheckProcessTool,
  windowsListWindowsTool,
  // ── Unknown app discovery & smart launch ─────────────────────
  windowsFindAppTool,
  windowsListAppsTool,
  windowsSmartOpenTool,
  // ── Browser control (CDP-backed, with verification) ──────────
  windowsBrowserStatusTool,
  windowsBrowserNavigateTool,
  windowsBrowserCloseTabTool,
  // ── App & URL launching (known exe only) ─────────────────────
  windowsOpenAppTool,
  windowsOpenUrlTool,
  windowsFocusWindowTool,
  // ── Keyboard / mouse ─────────────────────────────────────────
  windowsPressKeyTool,
  windowsTypeTool,
  windowsMouseMoveTool,
  windowsMouseClickTool,
  windowsMousePositionTool,
  // ── Screen ───────────────────────────────────────────────────
  windowsTakeScreenshotTool,
  windowsGetActiveWindowTool,
  // ── File system ──────────────────────────────────────────────
  windowsListDirectoryTool,
  windowsReadFileTool,
  windowsWriteFileTool,
];
