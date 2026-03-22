import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ModelConfig } from '../models/types';

/**
 * Dynamically scans the src/tools directory and safely loads all exported
 * LangChain DynamicStructuredTools. It automatically filters by OS to prevent
 * conflicts (e.g. loading Mac AppleScript tools on Windows).
 */
export async function loadNativeTools(
  enableInternet: boolean = true
): Promise<DynamicStructuredTool[]> {
  const tools: DynamicStructuredTool[] = [];
  const toolsDir = path.join(process.cwd(), 'src', 'tools');

  try {
    const toolFiles = await fs.readdir(toolsDir);
    
    // Track loaded tool names to prevent conflicts
    const loadedToolNames = new Set<string>();

    for (const file of toolFiles) {
      if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
      // Skip the loader file itself
      if (file === 'loader.ts') continue;
      
      // Auto-filter by Operating System
      const isWindows = os.platform() === 'win32';
      const isMac = os.platform() === 'darwin';
      if (file === 'windows.ts' && !isWindows) continue;
      if (file === 'mac.ts' && !isMac) continue;

      try {
        const module = await import(path.join(toolsDir, file));
        
        for (const key of Object.keys(module)) {
          const exported = module[key];
          
          if (Array.isArray(exported)) {
            // E.g. allWindowsTools = [tool1, tool2]
            for (const item of exported) {
              if (isValidTool(item)) {
                addToolSafely(item, tools, loadedToolNames, file);
              }
            }
          } else if (isValidTool(exported)) {
            // Check specific config flags
            if (key === 'webSearchTool' || key === 'webFetchTool') {
              if (!enableInternet) continue;
            }
            addToolSafely(exported, tools, loadedToolNames, file);
          }
        }
      } catch (err: any) {
        console.warn(`[ToolLoader] Failed to parse tools from ${file}:`, err.message);
      }
    }
  } catch (e: any) {
    console.error('[ToolLoader] Failed to read tools directory:', e.message);
  }

  return tools;
}

/** Check if an object structurally looks like a LangChain DynamicStructuredTool */
function isValidTool(obj: any): obj is DynamicStructuredTool {
  return obj && typeof obj === 'object' && obj.name && typeof obj.name === 'string' && obj.schema;
}

/** Prevent exact name collisions when dynamically loading */
function addToolSafely(
  tool: DynamicStructuredTool, 
  bucket: DynamicStructuredTool[], 
  nameSet: Set<string>, 
  sourceFile: string
) {
  if (nameSet.has(tool.name)) {
    console.warn(`[ToolLoader] Conflict: Tool name "${tool.name}" from ${sourceFile} is already loaded. Skipping.`);
    return;
  }
  nameSet.add(tool.name);
  bucket.push(tool);
}
