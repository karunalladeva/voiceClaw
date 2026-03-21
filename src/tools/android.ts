import { tool } from '@langchain/core/tools';
import { z } from 'zod';

let Adb: any = null;
let client: any = null;

// Native dynamic import to avoid ts-node converting `import()` to `require()`
async function getAdb() {
  if (!Adb) {
    const mod = await new Function("return import('@u4/adbkit')")();
    Adb = mod.default || mod;
  }
  return Adb;
}

async function getClient() {
  const adbLib = await getAdb();
  if (!client) {
    client = adbLib.createClient();
  }
  return client;
}

async function getDevice(serial?: string) {
  const adb = await getClient();
  const devices = await adb.listDevices();
  if (devices.length === 0) throw new Error('No Android devices connected. Connect via USB or WiFi ADB.');
  if (serial) {
    const match = devices.find((d: any) => d.id === serial);
    if (!match) throw new Error(`Device ${serial} not found. Available: ${devices.map((d: any) => d.id).join(', ')}`);
    return adb.getDevice(serial);
  }
  return adb.getDevice(devices[0].id);
}

export const adbListDevicesTool = tool(
  async () => {
    try {
      const adb = await getClient();
      const devices = await adb.listDevices();
      if (devices.length === 0) return 'No Android devices connected.';
      return devices.map((d: any) => `${d.id} (${d.type})`).join('\n');
    } catch (e: any) {
      return `Error: ${e.message}. Make sure ADB is installed and in PATH.`;
    }
  },
  {
    name: 'adb_list_devices',
    description: 'List all connected Android devices.',
    schema: z.object({}),
  }
);

export const adbShellTool = tool(
  async ({ command, serial }) => {
    try {
      const device = await getDevice(serial);
      const output = await device.shell(command);
      const adbLib = await getAdb();
      const result = await adbLib.util.readAll(output);
      return result.toString().trim() || '(no output)';
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_shell',
    description: 'Run a shell command on the Android device. Use for any ADB shell operation.',
    schema: z.object({
      command: z.string().describe('Shell command to run on the device'),
      serial: z.string().optional().describe('Device serial (optional, uses first device if omitted)'),
    }),
  }
);

export const adbTapTool = tool(
  async ({ x, y, serial }) => {
    try {
      const device = await getDevice(serial);
      await device.shell(`input tap ${x} ${y}`);
      return `Tapped at (${x}, ${y})`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_tap',
    description: 'Tap on a specific screen coordinate on the Android device.',
    schema: z.object({
      x: z.number().describe('X coordinate'),
      y: z.number().describe('Y coordinate'),
      serial: z.string().optional().describe('Device serial'),
    }),
  }
);

export const adbSwipeTool = tool(
  async ({ x1, y1, x2, y2, duration, serial }) => {
    try {
      const device = await getDevice(serial);
      const dur = duration || 300;
      await device.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${dur}`);
      return `Swiped from (${x1},${y1}) to (${x2},${y2}) over ${dur}ms`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_swipe',
    description: 'Swipe on the Android device screen from one point to another.',
    schema: z.object({
      x1: z.number().describe('Start X'),
      y1: z.number().describe('Start Y'),
      x2: z.number().describe('End X'),
      y2: z.number().describe('End Y'),
      duration: z.number().optional().describe('Swipe duration in ms (default 300)'),
      serial: z.string().optional().describe('Device serial'),
    }),
  }
);

export const adbInputTextTool = tool(
  async ({ text, serial }) => {
    try {
      const device = await getDevice(serial);
      const escaped = text.replace(/ /g, '%s').replace(/'/g, "\\'");
      await device.shell(`input text '${escaped}'`);
      return `Typed: "${text}"`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_input_text',
    description: 'Type text into the currently focused input field on the Android device.',
    schema: z.object({
      text: z.string().describe('Text to type'),
      serial: z.string().optional().describe('Device serial'),
    }),
  }
);

export const adbKeyEventTool = tool(
  async ({ keycode, serial }) => {
    try {
      const device = await getDevice(serial);
      await device.shell(`input keyevent ${keycode}`);
      return `Key event sent: ${keycode}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_key_event',
    description: 'Send a key event to the Android device. Common keycodes: KEYCODE_HOME (3), KEYCODE_BACK (4), KEYCODE_POWER (26), KEYCODE_ENTER (66), KEYCODE_VOLUME_UP (24), KEYCODE_VOLUME_DOWN (25).',
    schema: z.object({
      keycode: z.union([z.string(), z.number()]).describe('Android keycode number or name'),
      serial: z.string().optional().describe('Device serial'),
    }),
  }
);

export const adbOpenAppTool = tool(
  async ({ packageName, serial }) => {
    try {
      const device = await getDevice(serial);
      const output = await device.shell(`monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
      const adbLib = await getAdb();
      const result = await adbLib.util.readAll(output);
      return `Launched ${packageName}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_open_app',
    description: 'Open/launch an app on the Android device by package name (e.g. com.whatsapp, com.android.chrome).',
    schema: z.object({
      packageName: z.string().describe('Android package name of the app to open'),
      serial: z.string().optional().describe('Device serial'),
    }),
  }
);

export const adbListAppsTool = tool(
  async ({ filter, serial }) => {
    try {
      const device = await getDevice(serial);
      const cmd = filter === 'system' ? 'pm list packages -s' :
                  filter === 'third-party' ? 'pm list packages -3' :
                  'pm list packages -3';
      const output = await device.shell(cmd);
      const adbLib = await getAdb();
      const result = await adbLib.util.readAll(output);
      const packages = result.toString().trim().split('\n')
        .map((line: string) => line.replace('package:', '').trim())
        .filter(Boolean);
      return packages.length > 0 ? packages.join('\n') : 'No apps found.';
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_list_apps',
    description: 'List installed apps on the Android device.',
    schema: z.object({
      filter: z.enum(['all', 'third-party', 'system']).optional().describe('Filter type (default: third-party)'),
      serial: z.string().optional().describe('Device serial'),
    }),
  }
);

export const adbScreenshotTool = tool(
  async ({ serial }) => {
    try {
      const device = await getDevice(serial);
      const output = await device.shell('screencap -p /sdcard/screenshot_tmp.png');
      const adbLib = await getAdb();
      await adbLib.util.readAll(output);
      
      const stream = await device.pull('/sdcard/screenshot_tmp.png');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      
      // Clean up
      await device.shell('rm /sdcard/screenshot_tmp.png');

      const fs = await import('fs/promises');
      const path = await import('path');
      const filePath = path.join(process.cwd(), 'workspace', `screenshot_${Date.now()}.png`);
      await fs.writeFile(filePath, buffer);
      
      return `Screenshot saved to ${filePath} (${Math.round(buffer.length / 1024)}KB)`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_screenshot',
    description: 'Take a screenshot of the Android device screen and save it to the workspace.',
    schema: z.object({
      serial: z.string().optional().describe('Device serial'),
    }),
  }
);

export const adbGetScreenInfoTool = tool(
  async ({ serial }) => {
    try {
      const device = await getDevice(serial);
      const adbLib = await getAdb();

      const sizeOut = await device.shell('wm size');
      const size = (await adbLib.util.readAll(sizeOut)).toString().trim();
      
      const densityOut = await device.shell('wm density');
      const density = (await adbLib.util.readAll(densityOut)).toString().trim();
      
      const activityOut = await device.shell('dumpsys activity activities | grep mResumedActivity');
      const activity = (await adbLib.util.readAll(activityOut)).toString().trim();

      return `${size}\n${density}\nCurrent Activity: ${activity || 'unknown'}`;
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'adb_screen_info',
    description: 'Get screen resolution, density, and current foreground activity of the Android device.',
    schema: z.object({
      serial: z.string().optional().describe('Device serial'),
    }),
  }
);

export const allAdbTools = [
  adbListDevicesTool,
  adbShellTool,
  adbTapTool,
  adbSwipeTool,
  adbInputTextTool,
  adbKeyEventTool,
  adbOpenAppTool,
  adbListAppsTool,
  adbScreenshotTool,
  adbGetScreenInfoTool,
];
