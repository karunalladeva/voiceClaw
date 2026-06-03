#!/usr/bin/env node

import "../stdio-guard";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";
import { MongoClient, Collection } from "mongodb";
import { filterMemoriesForContext, isValidLongTermMemory } from "../../agents/memory-policy";

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
  } catch (err: any) {
    console.error("[Memory MCP] Failed to connect to MongoDB. Using local file fallback.");
    dbClient = null;
    memoryCollection = null;
  }
}

connectMongo();

interface MemoryItem {
  id: string;
  timestamp: string;
  content: string;
  tags: string[];
  embedding?: number[];
}

async function getMemory(): Promise<MemoryItem[]> {
  try {
    const data = await fs.readFile(MEMORY_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveMemory(memory: MemoryItem[]) {
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
  await fs.writeFile(MEMORY_FILE, JSON.stringify(memory, null, 2), "utf-8");
}

/**
 * Generate a vector embedding for text using Ollama.
 */
async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch("http://localhost:11434/api/embeddings", {
      method: "POST",
      body: JSON.stringify({
        model: "nomic-embed-text",
        prompt: text,
      }),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    return data.embedding;
  } catch (err: any) {
    console.error("[Memory MCP] Embedding failed (Ollama connection issue or model missing):", err.message);
    return null;
  }
}

/**
 * Calculate Cosine Similarity between two vectors.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
        description: "Search past memories using Semantic Search (vector similarity).",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The natural language query to search for" },
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
      {
        name: "save_skill",
        description: "Save a learned skill as a SKILL.md file in workspace/learned-skills/.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Kebab-case skill name (e.g. python-env-setup)" },
            description: { type: "string", description: "One-line description of the skill" },
            content: { type: "string", description: "Full markdown content of the skill" },
          },
          required: ["name", "description", "content"],
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
      let tags: string[] = [];
      if (Array.isArray(args.tags)) {
        tags = args.tags.map(String);
      } else if (typeof args.tags === 'string' && args.tags.length > 0) {
        try {
          if (args.tags.trim().startsWith('[')) {
            const parsed = JSON.parse(args.tags);
            if (Array.isArray(parsed)) tags = parsed.map(String);
          } else {
            tags = args.tags.split(',').map(t => t.trim()).filter(Boolean);
          }
        } catch (_) {
          tags = args.tags.split(',').map(t => t.trim()).filter(Boolean);
        }
      }

      if (!isValidLongTermMemory(content, tags)) {
        return {
          content: [{ type: "text", text: "Skipped: content looks like chat history or automation setup, not a durable user fact." }],
        };
      }

      const newItem: MemoryItem = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        content,
        tags,
        embedding: await getEmbedding(content) || undefined,
      };

      if (memoryCollection) {
        await memoryCollection.insertOne(newItem);
      } else {
        const memories = await getMemory();
        memories.push(newItem);
        await saveMemory(memories);
      }
      return {
        content: [{ type: "text", text: `Memory stored successfully ID: ${newItem.id}${newItem.embedding ? ' (Smart Semantic Indexing enabled)' : ' (Warning: Embedding failed, falling back to keyword search)'}` }],
      };

    } else if (name === "search_memory") {
      const rawQuery = (args.query as string).toLowerCase();
      const stopWords = new Set(['hey', 'buddy', 'how', 'is', 'the', 'in', 'my', 'at', 'on', 'with', 'a', 'an', 'and', 'for', 'of', 'to', 'me', 'you', 'it', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'about']);
      const queryWords = rawQuery.split(/[^a-z0-9]/i).filter(w => w.length > 1 && !stopWords.has(w));
      const queryEmbedding = await getEmbedding(rawQuery);

      let memories: MemoryItem[] = [];
      let updatedAny = false;

      if (memoryCollection) {
        memories = await memoryCollection.find({}).toArray() as any;
      } else {
        memories = await getMemory();
      }

      const results = await Promise.all(memories.map(async m => {
        let kwScore = 0;
        const content = m.content.toLowerCase();
        queryWords.forEach(w => { if (content.includes(w)) kwScore++; });

        // ── Lazy Vectorization: Upgrade old memories on the fly ─────────────
        if (!m.embedding) {
          console.error(`[Memory MCP] Auto-vectorizing legacy memory: ${m.id}`);
          m.embedding = await getEmbedding(m.content) || undefined;
          updatedAny = true;
        }

        const semanticScore = queryEmbedding && m.embedding
          ? cosineSimilarity(queryEmbedding, m.embedding)
          : 0;

        // Semantic search is primary (0.8), keywords provide a safety net (0.2)
        const combinedScore = (semanticScore * 8) + (kwScore * 0.4);
        return { ...m, combinedScore, semanticScore };
      }));

      // If we upgraded any legacy memories, save the state
      if (updatedAny && !memoryCollection) {
        await saveMemory(memories);
      } else if (updatedAny && memoryCollection) {
        // Bulk update for Mongo would be better, but for this scale we'll just 
        // rely on them getting cached/re-indexed next time or do individual updates
        for (const m of memories.filter(m => m.embedding)) {
          await memoryCollection.updateOne({ id: m.id }, { $set: { embedding: m.embedding } });
        }
      }

      const filteredResults = filterMemoriesForContext(
        results.filter(m => m.combinedScore > 0.1),
      );
      filteredResults.sort((a, b) => b.combinedScore - a.combinedScore || b.timestamp.localeCompare(a.timestamp));

      if (filteredResults.length === 0) {
        return {
          content: [{ type: "text", text: `No memories found related to "${rawQuery}".` }],
        };
      }

      const topResults = filteredResults.slice(0, 5);
      const formatted = topResults.map(r =>
        `[Match: ${(r.semanticScore * 100).toFixed(1)}%] (${r.tags.join(',')}) - ${r.content}`
      ).join('\n');

      return {
        content: [{ type: "text", text: `Found ${filteredResults.length} related memories:\n${formatted}` }],
      };


    } else if (name === "list_memories") {
      let results: MemoryItem[] = [];
      if (memoryCollection) {
        results = await memoryCollection.find({}).sort({ timestamp: -1 }).toArray() as any;
      } else {
        results = await getMemory();
        results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      }
      return { content: [{ type: "text", text: JSON.stringify(filterMemoriesForContext(results)) }] };

    } else if (name === "delete_memory") {
      const id = args.id as string;
      if (memoryCollection) {
        await memoryCollection.deleteOne({ id });
      } else {
        const memories = await getMemory();
        const filtered = memories.filter(m => m.id !== id);
        await saveMemory(filtered);
      }
      return { content: [{ type: "text", text: `Memory ${id} deleted.` }] };

    } else if (name === "save_skill") {
      const skillName = (args.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const skillDir = path.join(process.cwd(), "workspace", "learned-skills", skillName);
      await fs.mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, "SKILL.md");
      const content = `---\nname: ${skillName}\ndescription: ${args.description as string}\ncreated: ${new Date().toISOString().split('T')[0]}\n---\n\n${args.content as string}`;
      await fs.writeFile(skillPath, content, "utf-8");
      return { content: [{ type: "text", text: `Skill saved to ${skillPath}` }] };

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
  console.error("Memory MCP Server running on stdio with Semantic Vector Search enabled");
});