#!/usr/bin/env node

import "../stdio-guard";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";

// Create MCP server
const server = new Server(
  {
    name: "filesystem-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Allowed directory for file operations (for security)
const ALLOWED_DIR = path.join(process.cwd(), "workspace");

async function ensureWorkspace() {
  try {
    await fs.access(ALLOWED_DIR);
  } catch {
    await fs.mkdir(ALLOWED_DIR, { recursive: true });
  }
}

// Ensure the workspace exists
ensureWorkspace();

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_file",
        description: "Read the contents of a file in the workspace",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "Name of the file to read",
            },
          },
          required: ["filename"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file in the workspace",
        inputSchema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "Name of the file to write",
            },
            content: {
              type: "string",
              description: "Content to write to the file",
            },
          },
          required: ["filename", "content"],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args || typeof args !== "object") {
    throw new Error("Invalid arguments");
  }

  const filename = args.filename as string;
  
  if (!filename) {
    throw new Error("Filename is required");
  }

  // Prevent directory traversal attacks
  const safePath = path.resolve(ALLOWED_DIR, path.basename(filename));

  if (!safePath.startsWith(ALLOWED_DIR)) {
    throw new Error("Access denied: File must be within workspace");
  }

  try {
    if (name === "read_file") {
      const content = await fs.readFile(safePath, "utf-8");
      return {
        content: [{ type: "text", text: content }],
      };
    } else if (name === "write_file") {
      const content = args.content as string;
      await fs.writeFile(safePath, content, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully wrote to ${filename}` }],
      };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server on stdio
const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("Filesystem MCP Server running on stdio");
});