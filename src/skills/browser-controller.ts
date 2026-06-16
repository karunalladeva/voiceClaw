import * as os from 'os';
import { BaseSkill, SkillDefinition } from './base-skill';
import { defineTool, type ToolDefinition } from '../runtime/tools';
import { allWindowsTools } from '../tools/windows';
import { allMacTools } from '../tools/mac';
import { shellExecTool } from '../tools/shell';

export default class BrowserControllerSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    const isMac = os.platform() === 'darwin';
    const isWin = os.platform() === 'win32';
    
    let tools: ToolDefinition[] = [shellExecTool];
    let osName: string = os.platform();
    let promptExtras = '';

    if (isMac) {
      tools.push(...allMacTools);
      osName = 'macOS';
      promptExtras =
        'Use mac_take_screenshot, mac_mouse_move, and mac_type_text for physical browser interactions. ' +
        'Remember that you cannot read the live DOM, so you must rely on taking screenshots and clicking coordinates.';
    } else if (isWin) {
      tools.push(...allWindowsTools);
      osName = 'Windows';
      promptExtras = `VITAL WORKFLOW FOR PHYSICAL BROWSING:
  You are piloting the user's native, installed browser physically via mouse and keyboard. You do NOT have Playwright or raw DOM access.
  1. MAP THE SCREEN: Use windows_read_screen with query: "Give me the X,Y coordinates of the [Target]" and expectedFormat: "json" or "html" to explicitly extract coordinate bounds of the UI.
  2. MOVE & VERIFY: Use windows_mouse_move to the X,Y coordinate. Then optionally take another quick windows_read_screen (or windows_mouse_position) to verify your mouse cursor is perfectly hovered over the target.
  3. CLICK: Execute windows_mouse_click.
  4. TYPE: To type into a search bar or form, click its coordinates first to focus it, then use windows_type_text.
  5. NAVIGATE: Use windows_browser_navigate to open or enforce a specific URL.

CRITICAL RULES:
- Never just guess X,Y coordinates blindly. Always extract them via windows_read_screen(expectedFormat="json").
- Always confirm via return messages if your click or type command actually ran successfully.
- If you get stuck in a visual loop, try pressing Tab (windows_type_text(text="{TAB}")) or Escape to reset context.`;
    }

    return {
      id: 'browser-controller',
      name: 'Physical Browser Automation',
      description: `Physically controls the currently active, installed web browser (Chrome/Edge) using vision processing, mouse clicks, and keyboard typing.`,
      triggerDescription:
        `Use this explicitly when the user asks to control, click, type, or interact with an active, visible website dynamically in their primary browser. ` +
        `Do not use this for plain data-scraping (use web_search/web_fetch instead). Use this when physical GUI clicking and typing is mandatory.`,
      systemPrompt:
        `You are a Web Navigation Agent controlling the user's installed ${osName} browser natively. ` +
        `You operate the browser exactly like a human user: by analyzing the pixels on the screen, moving the physical mouse, clicking, and typing.\n\n` +
        `TOOL GUIDE for ${osName}:\n` +
        `${promptExtras}\n\n` +
        `Remember: You are literally looking at the user's monitor and moving their real mouse. Be precise!`,
      tools: tools,
      enabled: true,
    };
  }
}
