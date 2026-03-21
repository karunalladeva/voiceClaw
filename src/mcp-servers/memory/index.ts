#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { MongoClient, Collection } from "mongodb";

// Create MCP server
const server = new Server(
  {
    name: "memory-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Fallback memory file
const MEMORY_FILE = path.join(process.cwd(), "workspace", "memory.json");
// MongoDB connection (Optional)
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = "talking_llm";
const COLLECTION_NAME = "memories";

let dbClient: MongoClient | null = null;
let memoryCollection: Collection | null = null;

async function connectMongo() {
  try {
    console.error("[Memory MCP] Attempting to connect to MongoDB...");
    dbClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await dbClient.connect();
    const db = dbClient.db(DB_NAME);
    memoryCollection = db.collection(COLLECTION_NAME);
    console.error("[Memory MCP] Successfully connected to MongoDB.");
  } catch (err) {
    console.error("[Memory MCP] Failed to connect to MongoDB. Using local file fallback.");
    dbClient = null;
    memoryCollection = null;
  }
}

// Call connect immediately but don't await, let it run in background
connectMongo();

interface MemoryItem {
  id: string;
  timestamp: string;
  content: string;
  tags: string[];
}

async function getMemory(): Promise<MemoryItem[]> {
  try {
    const data = await fs.readFile(MEMORY_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return []; // Return empty if file doesn't exist or is invalid
  }
}

async function saveMemory(memory: MemoryItem[]) {
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
  await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf-8");
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "store_memory",
        description: "Store a memory or context piece for future reference.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The information to remember" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Categorization tags (e.g. ['user_preference', 'fact'])",
            },
          },
          required: ["content"],
        },
      },
      {
        name: "search_memory",
        description: "Search past memories using a keyword query.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The keyword to search for" },
          },
          required: ["query"],
        },
      },
      {
        name: "list_memories",
        description: "List all stored memories.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "delete_memory",
        description: "Delete a stored memory by its ID.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The ID of the memory to delete" },
          },
          required: ["id"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args || typeof args !== "object") {
    throw new Error("Invalid arguments");
  }

  try {
    if (name === "store_memory") {
      const content = args.content as string;
      const tags = (args.tags as string[]) || [];
      
      const newItem: MemoryItem = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        content,
        tags,
      };

      if (memoryCollection) {
        // Use MongoDB
        await memoryCollection.insertOne(newItem);
        return {
          content: [{ type: "text", text: `Memory stored successfully in MongoDB. ID: ${newItem.id}` }],
        };
      } else {
        // Use local file fallback
        const memories = await getMemory();
        memories.push(newItem);
        await saveMemory(memories);
        return {
          content: [{ type: "text", text: `Memory stored successfully locally. ID: ${newItem.id}` }],
        };
      }
      
    } else if (name === "search_memory") {
      const query = (args.query as string).toLowerCase();
      
      let results: MemoryItem[] = [];

      if (memoryCollection) {
        // Use MongoDB Text Search or Regex
        const cursor = memoryCollection.find({
          $or: [
            { content: { $regex: query, $options: 'i' } },
            { tags: { $regex: query, $options: 'i' } }
          ]
        });
        results = await cursor.toArray() as any;
      } else {
        // Use local file fallback
        const memories = await getMemory();
        results = memories.filter(
          m => m.content.toLowerCase().includes(query) || 
               m.tags.some(t => t.toLowerCase().includes(query))
        );
      }
      
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No memories found matching "${query}".` }],
        };
      }
      
      const formattedResults = results.map(r => `[${r.timestamp}] (${r.tags.join(',')}) - ${r.content}`).join('\n');
      
      return {
        content: [{ type: "text", text: `Found ${results.length} memories:\n${formattedResults}` }],
      };
      
    } else if (name === "list_memories") {
      let results: MemoryItem[] = [];

      if (memoryCollection) {
        results = await memoryCollection.find({}).sort({ timestamp: -1 }).toArray() as any;
      } else {
        results = await getMemory();
        results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      }

      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };

    } else if (name === "delete_memory") {
      const id = args.id as string;

      if (memoryCollection) {
        await memoryCollection.deleteOne({ id });
      } else {
        const memories = await getMemory();
        const filtered = memories.filter(m => m.id !== id);
        await saveMemory(filtered);
      }

      return {
        content: [{ type: "text", text: `Memory ${id} deleted.` }],
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

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("Memory MCP Server running on stdio");
});