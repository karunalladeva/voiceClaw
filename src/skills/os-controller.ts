import * as os from 'os';
import { BaseSkill, SkillDefinition } from './base-skill';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { allWindowsTools } from '../tools/windows';
import { allMacTools } from '../tools/mac';
import { shellExecTool } from '../tools/shell';

export default class OsControllerSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    const isMac = os.platform() === 'darwin';
    const isWin = os.platform() === 'win32';
    
    // Always include the shell tool for lower-level fallback
    let tools: DynamicStructuredTool[] = [shellExecTool];
    let osName: string = os.platform();
    let promptExtras = '';

    if (isMac) {
      tools.push(...allMacTools);
      osName = 'macOS';
      promptExtras =
        'Use mac_open_app for launching applications and URLs. ' +
        'Use mac_type_text, mac_mouse_move, and mac_take_screenshot for UI and app interactions.';
    } else if (isWin) {
      tools.push(...allWindowsTools);
      osName = 'Windows';
      promptExtras =
        'DECISION WORKFLOW — always follow this order:\n' +
        '  1. CHECK STATE: Use windows_check_process or windows_list_windows to see if an app is already open.\n' +
        '  2. ACT based on findings — open, focus, or interact accordingly.\n' +
        '  3. VERIFY: Confirm success from the tool return value, not from assumption.\n\n' +
        'OPENING ANY APP:\n' +
        '  • Unknown app (Spotify, Discord, Steam, any game, etc.) → windows_smart_open("Spotify")\n' +
        '    It searches Start Menu (including Store/UWP apps), registry, and PATH automatically.\n' +
        '  • If smart_open fails → windows_find_app("Spotify") to see what is installed,\n' +
        '    or windows_list_apps("music") to browse installed apps by category keyword.\n' +
        '  • Known exe (notepad, calc, explorer) → windows_open_app.\n' +
        '  • App already open → windows_focus_window to bring it to front.\n\n' +
        'BROWSER TASKS (Chrome / Edge):\n' +
        '  • windows_browser_status — check if browser is open and see all tabs with URLs.\n' +
        '  • windows_browser_navigate — open a URL with full CDP verification.\n' +
        '  • windows_browser_close_tab — close a tab by ID or URL keyword.\n\n' +
        'UI / MOUSE-FIRST NAVIGATION (use BEFORE shell):\n' +
        '  If a dedicated tool fails or the target cannot be opened via its name, SWITCH TO MOUSE MODE:\n' +
        '  1. windows_read_screen — Ask explicitly for exact [X, Y] pixel coordinates of the target (e.g. "What are the X, Y coordinates of the Search button?").\n' +
        '  2. windows_mouse_move / windows_mouse_click — Use the returned coordinates to click.\n' +
        '  3. **STRICT VERIFICATION LOOP**: If you are unsure about the click, first use windows_mouse_move(x, y), then call windows_read_screen again to visually verify the mouse cursor is actually hovering the correct target before executing windows_mouse_click.\n' +
        '  4. windows_press_key (e.g. Win, Tab, Enter, Escape) — navigate menus or dialogs.\n' +
        '  5. windows_type_text — type into a search box, address bar, or dialog.\n' +
        '  Repeat screenshot → verify → click until the task is complete.\n\n' +
        'WEB DATA EXTRACTION & DOM:\n' +
        '  If you need to read complex data from a website, do NOT rely purely on vision screenshots. Use the `web_search` and `web_fetch` tools to natively parse the HTML DOM data reliably.\n\n' +
        'SHELL (last resort only — use mouse first if shell is unavailable):\n' +
        '  Use shell_exec ONLY when no GUI tool can accomplish the task.\n' +
        '  If shell_exec fails with a "not found" error, do NOT retry shell — switch to mouse navigation instead.';

    }

    return {
      id: 'os-controller',
      name: 'OS Controller',
      description: `Controls the local ${osName} machine — open apps and websites, type, use mouse, take screenshots, and read/write files anywhere on the OS.`,
      triggerDescription:
        `Use when the user asks to control their local computer, open an application or website, ` +
        `open a browser tab (e.g. Gmail, YouTube), type text, use the mouse, take a desktop screenshot, ` +
        `or explore, read, and write files anywhere on their filesystem.`,
      systemPrompt:
        `You are a System Automation Agent controlling a ${osName} machine. ` +
        `You control the user's computer: check what is running, open/close apps and browser tabs, ` +
        `type, click, take screenshots, and manage files.\n\n` +
        `TOOL GUIDE for ${osName}:\n` +
        `${promptExtras}\n` +
        `FILE SYSTEM: Use the list_directory, read_file, and write_file tools to manage any file.\n` +
        `FALLBACK: For anything not covered by a dedicated tool, use shell_exec with a PowerShell one-liner.\n\n` +
        `RULES:\n` +
        `- Always check state before acting. Never assume an app is open or closed.\n` +
        `- Always report what actually happened based on the tool's return value, not what you hoped would happen.\n` +
        `- If a tool returns an error or unexpected result, try an alternative approach before giving up.\n` +
        `- Respond with one brief, natural spoken sentence confirming the result.`,
      tools: tools,
      enabled: true,
    };
  }
}
