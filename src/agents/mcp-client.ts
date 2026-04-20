import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as path from "path";

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private tools: DynamicStructuredTool[] = [];
  private memoryServerId: string | null | undefined = undefined; // undefined = not yet discovered

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
  async loadTools(): Promise<DynamicStructuredTool[]> {
    this.tools = [];

    for (const [serverId, client] of this.clients.entries()) {
      try {
        const response = await client.listTools();
        
        for (const mcpTool of response.tools) {
          // Convert the JSON schema to a minimal Zod schema for LangChain
          // For a production app, you might use json-schema-to-zod, but here we do a basic mapping
          let schema = z.object({});
          if (mcpTool.inputSchema?.properties) {
            const shape: any = {};
            const required = mcpTool.inputSchema.required || [];
            
            for (const [key, prop] of Object.entries<any>(mcpTool.inputSchema.properties)) {
              let zType: any = z.any();
              if (prop.type === "string") zType = z.string().describe(prop.description || "");
              else if (prop.type === "number") zType = z.number().describe(prop.description || "");
              else if (prop.type === "boolean") zType = z.boolean().describe(prop.description || "");
              
              if (!required.includes(key)) {
                zType = zType.optional();
              }
              shape[key] = zType;
            }
            schema = z.object(shape);
          }

          // Create the LangChain tool
          const lcTool = new DynamicStructuredTool({
            name: `${serverId}_${mcpTool.name}`,
            description: mcpTool.description || `Execute ${mcpTool.name} on ${serverId}`,
            schema,
            func: async (input: any) => {
              console.log(`[MCP Execution] Calling ${mcpTool.name} on ${serverId} with args:`, input);
              try {
                const result = await client.callTool({
                  name: mcpTool.name,
                  arguments: input
                });
                
                // Format the result back into a string for the LLM
                if (result.isError) {
                  return `Error: ${JSON.stringify(result.content)}`;
                }
                
                const textContents = (result.content as any[])
                  .filter((c: any) => c.type === 'text')
                  .map((c: any) => c.text)
                  .join('\n');
                  
                return textContents || "Tool executed successfully with no text output.";
              } catch (err: any) {
                return `Tool Execution Failed: ${err.message}`;
              }
            },
          });

          this.tools.push(lcTool);
          console.log(`[MCP Client] Loaded tool: ${lcTool.name}`);
        }
      } catch (err) {
        console.error(`[MCP Client] Failed to load tools from ${serverId}:`, err);
      }
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
    try {
      const client = this.clients.get(serverId)!;
      const result = await client.callTool({ name: toolName, arguments: args });
      if (result.isError) return '';
      return (result.content as any[])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    } catch {
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
    return text.includes('No memories found') ? '' : text;
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
          return JSON.parse(jsonPart);
        } catch (_) {}
      }
      
      return JSON.parse(text);
    } catch {
      return [];
    }
  }

  /** Store a new memory. */
  async addMemory(content: string, tags: string[] = []): Promise<string> {
    return this.callMemoryTool('store_memory', { content, tags });
  }

  /** Delete a memory by ID. */
  async deleteMemory(id: string): Promise<string> {
    return this.callMemoryTool('delete_memory', { id });
  }
}