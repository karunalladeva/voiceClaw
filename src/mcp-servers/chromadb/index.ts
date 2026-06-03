#!/usr/bin/env node

import "../stdio-guard";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ChromaClient } from "chromadb";

const server = new Server(
  {
    name: "chromadb-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
let chromaClient: ChromaClient | null = null;

function getClient(): ChromaClient {
  if (!chromaClient) {
    chromaClient = new ChromaClient({ path: CHROMA_URL });
  }
  return chromaClient;
}

async function getCollection(name: string, createIfMissing: boolean = true): Promise<any> {
  const client = getClient();
  if (createIfMissing) {
    return client.getOrCreateCollection({ name });
  }
  return client.getCollection({ name });
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "chroma_list_collections",
        description: "List available ChromaDB collections.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "chroma_upsert",
        description: "Upsert documents/embeddings into a ChromaDB collection.",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "Collection name." },
            ids: { type: "array", items: { type: "string" }, description: "Record IDs." },
            documents: { type: "array", items: { type: "string" }, description: "Optional document texts." },
            embeddings: {
              type: "array",
              items: { type: "array", items: { type: "number" } },
              description: "Optional vector embeddings.",
            },
            metadatas: {
              type: "array",
              items: { type: "object" },
              description: "Optional metadata objects per record.",
            },
          },
          required: ["collection", "ids"],
        },
      },
      {
        name: "chroma_query",
        description: "Semantic query in a ChromaDB collection using query text or embeddings.",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "Collection name." },
            queryTexts: { type: "array", items: { type: "string" }, description: "Query texts." },
            queryEmbeddings: {
              type: "array",
              items: { type: "array", items: { type: "number" } },
              description: "Optional query vectors.",
            },
            nResults: { type: "number", description: "Top K results.", default: 5 },
            where: { type: "object", description: "Optional metadata filter." },
          },
          required: ["collection"],
        },
      },
      {
        name: "chroma_get",
        description: "Fetch records from a ChromaDB collection by ids and/or filter.",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "Collection name." },
            ids: { type: "array", items: { type: "string" }, description: "Optional IDs filter." },
            where: { type: "object", description: "Optional metadata filter." },
            limit: { type: "number", description: "Optional limit.", default: 20 },
            offset: { type: "number", description: "Optional offset.", default: 0 },
          },
          required: ["collection"],
        },
      },
      {
        name: "chroma_delete",
        description: "Delete records from a ChromaDB collection by ids and/or filter.",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "Collection name." },
            ids: { type: "array", items: { type: "string" }, description: "Optional IDs to delete." },
            where: { type: "object", description: "Optional metadata filter." },
          },
          required: ["collection"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args || {}) as Record<string, any>;

  try {
    if (name === "chroma_list_collections") {
      const client = getClient();
      const collections = await client.listCollections();
      const names = collections.map((c: any) => c.name || c);
      return { content: [{ type: "text", text: JSON.stringify({ collections: names }) }] };
    }

    if (name === "chroma_upsert") {
      const collectionName = String(input.collection || "").trim();
      if (!collectionName) throw new Error("collection is required");
      const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
      if (ids.length === 0) throw new Error("ids must be a non-empty array");

      const collection = await getCollection(collectionName, true);
      await collection.upsert({
        ids,
        documents: Array.isArray(input.documents) ? input.documents.map(String) : undefined,
        embeddings: Array.isArray(input.embeddings) ? input.embeddings : undefined,
        metadatas: Array.isArray(input.metadatas) ? input.metadatas : undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, collection: collectionName, upserted: ids.length }) }] };
    }

    if (name === "chroma_query") {
      const collectionName = String(input.collection || "").trim();
      if (!collectionName) throw new Error("collection is required");
      const collection = await getCollection(collectionName, false);
      const nResults = Math.max(1, Math.min(100, Number(input.nResults || 5)));
      const result = await collection.query({
        queryTexts: Array.isArray(input.queryTexts) ? input.queryTexts.map(String) : undefined,
        queryEmbeddings: Array.isArray(input.queryEmbeddings) ? input.queryEmbeddings : undefined,
        nResults,
        where: input.where && typeof input.where === "object" ? input.where : undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (name === "chroma_get") {
      const collectionName = String(input.collection || "").trim();
      if (!collectionName) throw new Error("collection is required");
      const collection = await getCollection(collectionName, false);
      const limit = Math.max(1, Math.min(1000, Number(input.limit || 20)));
      const offset = Math.max(0, Number(input.offset || 0));
      const result = await collection.get({
        ids: Array.isArray(input.ids) ? input.ids.map(String) : undefined,
        where: input.where && typeof input.where === "object" ? input.where : undefined,
        limit,
        offset,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (name === "chroma_delete") {
      const collectionName = String(input.collection || "").trim();
      if (!collectionName) throw new Error("collection is required");
      const collection = await getCollection(collectionName, false);
      await collection.delete({
        ids: Array.isArray(input.ids) ? input.ids.map(String) : undefined,
        where: input.where && typeof input.where === "object" ? input.where : undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, collection: collectionName }) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error(`[Chroma MCP] Server running on stdio (CHROMA_URL=${CHROMA_URL})`);
});
