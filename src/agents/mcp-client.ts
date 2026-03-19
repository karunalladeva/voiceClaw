import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as path from "path";

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private tools: DynamicStructuredTool[] = [];

  /**
   * Start a local MCP server script and connect to it
   */
  async connectLocalServer(serverId: string, scriptPath: string) {
    console.log(`[MCP Client] Connecting to local server: ${serverId} at ${scriptPath}`);
    
    // Configure the stdio transport to spawn the node script
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["ts-node", scriptPath],
      env: process.env as Record<string, string>,
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
}