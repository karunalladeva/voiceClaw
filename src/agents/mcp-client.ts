import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as path from "path";

import { filterMemoriesForContext, isValidLongTermMemory } from './memory-policy';
import { isPipeClosedError } from '../utils/pipe-errors';

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private tools: DynamicStructuredTool[] = [];
  private memoryServerId: string | null | undefined = undefined; // undefined = not yet discovered
  private stats = {
    totalToolCalls: 0,
    failedToolCalls: 0,
    totalMemoryCalls: 0,
    failedMemoryCalls: 0,
    lastToolCallAt: 0,
  };

  /**
   * Start a local MCP server script and connect to it
   */
  async connectLocalServer(serverId: string, scriptPath: string, options: { command?: string; args?: string[]; env?: Record<string, string> } = {}) {
    console.log(`[MCP Client] Connecting to local server: ${serverId} at ${scriptPath || 'custom command'}`);
    
    // Configure the stdio transport to spawn the node script
    const transport = new StdioClientTransport({
      command: options.command || "npx",
      args: options.args || ["ts-node", scriptPath],
      env: { ...process.env, ...(options.env || {}) } as Record<string, string>,
    });

    const client = new Client(
      { name: "talking-llm-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.set(serverId, client);
    
    console.log(`[MCP Client] Connected to ${serverId}`);
    return client;
  }

  /**
   * Load tools from all connected MCP servers and convert them to LangChain tools
   */
  private buildZodFromJsonSchema(schemaNode: any): any {
    if (!schemaNode || typeof schemaNode !== 'object') return z.any();
    if (Array.isArray(schemaNode.enum) && schemaNode.enum.length > 0) {
      const vals = schemaNode.enum.filter((v: any) => typeof v === 'string');
      if (vals.length > 0) return z.enum(vals as [string, ...string[]]);
    }
    if (schemaNode.type === 'string') return z.string();
    if (schemaNode.type === 'number' || schemaNode.type === 'integer') return z.number();
    if (schemaNode.type === 'boolean') return z.boolean();
    if (schemaNode.type === 'array') {
      const itemSchema = this.buildZodFromJsonSchema(schemaNode.items);
      return z.array(itemSchema);
    }
    if (schemaNode.type === 'object' || schemaNode.properties) {
      const shape: Record<string, any> = {};
      const required = Array.isArray(schemaNode.required) ? schemaNode.required : [];
      const props = schemaNode.properties || {};
      for (const [key, prop] of Object.entries<any>(props)) {
        let built = this.buildZodFromJsonSchema(prop);
        if (prop?.description && typeof built.describe === 'function') {
          built = built.describe(prop.description);
        }
        if (!required.includes(key)) built = built.optional();
        shape[key] = built;
      }
      return z.object(shape);
    }
    return z.any();
  }

  private formatToolResult(result: any, serverId: string, toolName: string): string {
    const textContents = (result.content as any[])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')
      .trim();
    const payload = textContents || "Tool executed successfully with no text output.";
    const nowIso = new Date().toISOString();
    return [
      `[MCP_RESULT]`,
      `server=${serverId}`,
      `tool=${toolName}`,
      `fetched_at=${nowIso}`,
      `---`,
      payload,
    ].join('\n');
  }

  async loadTools(): Promise<DynamicStructuredTool[]> {
    this.tools = [];
    const loadedNames: string[] = [];

    for (const [serverId, client] of this.clients.entries()) {
      try {
        const response = await client.listTools();
        
        for (const mcpTool of response.tools) {
          const schema = this.buildZodFromJsonSchema(mcpTool.inputSchema || { type: 'object', properties: {} });

          // Create the LangChain tool
          const lcTool = new DynamicStructuredTool({
            name: `${serverId}_${mcpTool.name}`,
            description: mcpTool.description || `Execute ${mcpTool.name} on ${serverId}`,
            schema,
            func: async (input: any) => {
              console.log(`[MCP Execution] Calling ${mcpTool.name} on ${serverId} with args:`, input);
              this.stats.totalToolCalls += 1;
              this.stats.lastToolCallAt = Date.now();
              try {
                const result = await client.callTool({
                  name: mcpTool.name,
                  arguments: input
                });
                
                // Format the result back into a string for the LLM
                if (result.isError) {
                  this.stats.failedToolCalls += 1;
                  return `Error: ${JSON.stringify(result.content)}`;
                }
                return this.formatToolResult(result, serverId, mcpTool.name);
              } catch (err: any) {
                this.stats.failedToolCalls += 1;
                return `Tool Execution Failed: ${err.message}`;
              }
            },
          });

          this.tools.push(lcTool);
          loadedNames.push(lcTool.name);
        }
      } catch (err) {
        console.error(`[MCP Client] Failed to load tools from ${serverId}:`, err);
      }
    }

    if (loadedNames.length > 0) {
      console.log(
        `[MCP Client] Loaded ${loadedNames.length} tool(s) from ${this.clients.size} server(s): ${loadedNames.join(', ')}`,
      );
    }

    return this.tools;
  }
  
  getTools() {
    return this.tools;
  }

  /**
   * Find which connected server exposes the memory tools (cached after first discovery).
   */
  private async findMemoryServerId(): Promise<string | null> {
    if (this.memoryServerId !== undefined) return this.memoryServerId;

    for (const [serverId, client] of this.clients.entries()) {
      try {
        const { tools } = await client.listTools();
        if (tools.some(t => t.name === 'search_memory')) {
          this.memoryServerId = serverId;
          return serverId;
        }
      } catch { /* server may not be ready */ }
    }

    this.memoryServerId = null;
    return null;
  }

  private async callMemoryTool(toolName: string, args: Record<string, any> = {}): Promise<string> {
    const serverId = await this.findMemoryServerId();
    if (!serverId) return '';
    this.stats.totalMemoryCalls += 1;
    this.stats.lastToolCallAt = Date.now();
    try {
      const client = this.clients.get(serverId)!;
      const result = await client.callTool({ name: toolName, arguments: args });
      if (result.isError) {
        this.stats.failedMemoryCalls += 1;
        return '';
      }
      return (result.content as any[])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    } catch {
      this.stats.failedMemoryCalls += 1;
      return '';
    }
  }

  /** Returns true if the memory MCP server is reachable. */
  async isMemoryAvailable(): Promise<boolean> {
    return (await this.findMemoryServerId()) !== null;
  }

  /** Search long-term memory. Returns formatted results or empty string. */
  async searchMemory(query: string): Promise<string> {
    const text = await this.callMemoryTool('search_memory', { query });
    if (!text || text.includes('No memories found')) return '';
    return `<memory_search_result freshness="historical" fetched_at="${new Date().toISOString()}">\n${text}\n</memory_search_result>`;
  }

  /** List all stored memories as a parsed array. */
  async listMemories(): Promise<any[]> {
    try {
      const text = await this.callMemoryTool('list_memories');
      if (!text) return [];
      
      // Attempt to find the JSON array if mixed with text
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        const jsonPart = text.substring(firstBracket, lastBracket + 1);
        try {
          return filterMemoriesForContext(JSON.parse(jsonPart));
        } catch (_) {}
      }
      
      return filterMemoriesForContext(JSON.parse(text));
    } catch {
      return [];
    }
  }

  /** Store a new memory. */
  async addMemory(content: string, tags: string[] = []): Promise<string> {
    if (!isValidLongTermMemory(content, tags)) {
      return 'Skipped: content looks like chat history, not a durable user fact.';
    }
    return this.callMemoryTool('store_memory', { content, tags });
  }

  /** Delete a memory by ID. */
  async deleteMemory(id: string): Promise<string> {
    return this.callMemoryTool('delete_memory', { id });
  }

  getStats() {
    const totalCalls = this.stats.totalToolCalls + this.stats.totalMemoryCalls;
    const failedCalls = this.stats.failedToolCalls + this.stats.failedMemoryCalls;
    return {
      ...this.stats,
      totalCalls,
      failedCalls,
      successRate: totalCalls > 0 ? Number((((totalCalls - failedCalls) / totalCalls) * 100).toFixed(2)) : 100,
      connectedServers: this.clients.size,
      loadedTools: this.tools.length,
    };
  }

  /** Close all MCP child processes (call on gateway shutdown). */
  async disconnectAll(): Promise<void> {
    for (const [serverId, client] of this.clients.entries()) {
      try {
        await client.close();
      } catch (err: unknown) {
        if (!isPipeClosedError(err)) {
          console.warn(`[MCP Client] Error closing ${serverId}:`, err);
        }
      }
    }
    this.clients.clear();
    this.tools = [];
    this.memoryServerId = undefined;
  }
}