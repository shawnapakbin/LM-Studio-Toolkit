/**
 * RAG (Retrieval-Augmented Generation) MCP Server
 *
 * Provides document ingestion, chunking, embedding, and semantic search capabilities.
 * Uses LM Studio's built-in embeddings endpoint for vector generation.
 * Stores vectors in-memory with file-based persistence.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { z } from "zod";
import { startServer } from "../shared/mcp-helpers.js";

// ========== Schemas ==========

const chunkTextArgs = z.object({
  text: z.string(),
  chunkSize: z.number().positive().max(5000).optional().default(1000),
  chunkOverlap: z.number().nonnegative().optional().default(200),
  strategy: z.enum(["fixed", "sentence", "semantic"]).optional().default("fixed"),
});

const generateEmbeddingsArgs = z.object({
  texts: z.string().array(),
  model: z.string().optional().default("nomic-embed-text"),
});

const storeDocumentArgs = z.object({
  documentId: z.string(),
  title: z.string(),
  content: z.string(),
  url: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  chunkSize: z.number().positive().optional().default(1000),
  chunkOverlap: z.number().nonnegative().optional().default(200),
});

const searchKnowledgeArgs = z.object({
  query: z.string(),
  topK: z.number().positive().max(20).optional().default(5),
  includeSemanticScore: z.boolean().optional().default(true),
});

const listDocumentsArgs = z.object({
  limit: z.number().positive().optional().default(100),
});

const deleteDocumentArgs = z.object({
  documentId: z.string(),
});

const extractPdfArgs = z.object({
  filePath: z.string(),
  maxPages: z.number().positive().optional(),
});

const extractDocxArgs = z.object({
  filePath: z.string(),
});

const extractMarkdownArgs = z.object({
  filePath: z.string(),
});

// ========== Types ==========

interface Chunk {
  id: string;
  documentId: string;
  text: string;
  index: number;
  embedding?: number[];
}

interface Document {
  id: string;
  title: string;
  url?: string;
  addedAt: string;
  metadata?: Record<string, unknown>;
  chunkCount: number;
}

interface VectorStore {
  documents: Map<string, Document>;
  chunks: Map<string, Chunk>;
  nextChunkId: number;
}

// ========== Configuration ==========

const RAG_DATA_DIR = process.env.RAG_DATA_DIR || path.join(process.cwd(), "rag-data");
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:1234";
const INSECURE_TLS = process.env.MCP_INSECURE_TLS === "1";
const EMBEDDING_CACHE: Map<string, number[]> = new Map();

if (INSECURE_TLS) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// ========== Vector Store ==========

const vectorStore: VectorStore = {
  documents: new Map(),
  chunks: new Map(),
  nextChunkId: 0,
};

async function initializeVectorStore(): Promise<void> {
  try {
    await fs.mkdir(RAG_DATA_DIR, { recursive: true });
    const indexPath = path.join(RAG_DATA_DIR, "index.json");

    try {
      const data = await fs.readFile(indexPath, "utf-8");
      const loaded = JSON.parse(data);
      vectorStore.documents = new Map(Object.entries(loaded.documents || {}));
      vectorStore.chunks = new Map(
        Object.entries(loaded.chunks || {}).map(([key, chunk]) => [
          key,
          {
            ...(chunk as Record<string, unknown>),
            id: key,
          } as Chunk,
        ]),
      );
      vectorStore.nextChunkId = loaded.nextChunkId || 0;
      console.log(
        `[RAG] Loaded vector store: ${vectorStore.documents.size} documents, ${vectorStore.chunks.size} chunks`,
      );
    } catch {
      console.log("[RAG] Starting with empty vector store");
    }
  } catch (error) {
    console.error("[RAG] Failed to initialize vector store:", error);
  }
}

async function persisVectorStore(): Promise<void> {
  try {
    const indexPath = path.join(RAG_DATA_DIR, "index.json");
    const data = {
      documents: Object.fromEntries(vectorStore.documents),
      chunks: Object.fromEntries(vectorStore.chunks),
      nextChunkId: vectorStore.nextChunkId,
    };
    await fs.writeFile(indexPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("[RAG] Failed to persist vector store:", error);
  }
}

// ========== Chunking ==========

function chunkTextFixed(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start <= 0) start = end;
  }

  return chunks;
}

function chunkTextBySentence(text: string, targetSize: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= targetSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

function chunkTextSemantic(text: string, targetSize: number): string[] {
  // Simple semantic chunking: split on paragraphs first, then by size
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if ((currentChunk + "\n\n" + paragraph).length <= targetSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    }
  }

  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

// ========== Embeddings ==========

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  const toFetch: { text: string; index: number }[] = [];

  // Check cache first
  for (const [i, text] of texts.entries()) {
    const cached = EMBEDDING_CACHE.get(text);
    if (cached) {
      results[i] = cached;
    } else {
      toFetch.push({ text, index: i });
    }
  }

  if (toFetch.length === 0) {
    return results;
  }

  try {
    const response = await fetch(`${LM_STUDIO_URL}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        input: toFetch.map((t) => t.text),
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio embeddings API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    // Map results back to original order
    for (let i = 0; i < toFetch.length; i++) {
      const embedding = data.data[i]?.embedding || [];
      const request = toFetch[i];
      if (!request) {
        continue;
      }
      results[request.index] = embedding;
      EMBEDDING_CACHE.set(request.text, embedding);
    }

    return results;
  } catch (error) {
    throw new Error(
      `Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dotProduct += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ========== Document Extraction ==========

async function extractPdfText(filePath: string, _maxPages?: number): Promise<string> {
  // Dynamic import to avoid requiring pdf-parse in browser contexts
  let pdfParse: ((dataBuffer: Buffer, options?: unknown) => Promise<{ text: string }>) | undefined;
  try {
    const module = await import("pdf-parse");
    pdfParse = (module.default ?? module) as unknown as (
      dataBuffer: Buffer,
      options?: unknown,
    ) => Promise<{ text: string }>;
  } catch {
    throw new Error("pdf-parse not available");
  }

  const data = await fs.readFile(filePath);
  if (!pdfParse) {
    throw new Error("pdf-parse not available");
  }
  const pdf = await pdfParse(data, _maxPages ? { max: _maxPages } : undefined);
  return pdf.text;
}

async function extractDocxText(filePath: string): Promise<string> {
  // Dynamic import to avoid requiring mammoth in browser contexts
  let mammoth: unknown;
  try {
    mammoth = (await import("mammoth")).default;
  } catch {
    throw new Error("mammoth not available");
  }

  const buffer = await fs.readFile(filePath);
  const result = await (
    mammoth as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> }
  ).extractRawText({
    buffer,
  });
  return result.value;
}

async function extractMarkdownText(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8");
  // Basic cleanup: remove markdown syntax while preserving structure
  return content
    .replace(/^#+\s+/gm, "") // Headers
    .replace(/\*\*(.*?)\*\*/g, "$1") // Bold
    .replace(/__(.*?)__/g, "$1") // Italic
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // Links
    .replace(/```[\s\S]*?```/g, "") // Code blocks
    .replace(/`([^`]+)`/g, "$1"); // Inline code
}

function stripHtmlForRag(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWebpageContent(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: INSECURE_TLS });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    const html = await page.content();
    return stripHtmlForRag(html);
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

// ========== MCP Server ==========

async function main(): Promise<void> {
  await initializeVectorStore();

  await startServer("rag-mcp-server", "0.1.0", [
    {
      tool: {
        name: "chunk_text",
        description: "Split text into chunks for embedding and storage.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            chunkSize: {
              type: "number",
              minimum: 1,
              maximum: 5000,
              description: "Characters per chunk",
            },
            chunkOverlap: { type: "number", minimum: 0, description: "Overlap between chunks" },
            strategy: {
              type: "string",
              enum: ["fixed", "sentence", "semantic"],
              description: "Chunking strategy",
            },
          },
          required: ["text"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = chunkTextArgs.parse(args);
        let chunks: string[];

        switch (parsed.strategy) {
          case "sentence":
            chunks = chunkTextBySentence(parsed.text, parsed.chunkSize);
            break;
          case "semantic":
            chunks = chunkTextSemantic(parsed.text, parsed.chunkSize);
            break;
          default:
            chunks = chunkTextFixed(parsed.text, parsed.chunkSize, parsed.chunkOverlap);
        }

        return JSON.stringify({
          chunkCount: chunks.length,
          chunks: chunks
            .slice(0, 5)
            .map((c, i) => ({ index: i, preview: c.slice(0, 100) + "..." })),
          strategy: parsed.strategy,
        });
      },
    },
    {
      tool: {
        name: "generate_embeddings",
        description: "Generate embeddings for text using LM Studio's embeddings API.",
        inputSchema: {
          type: "object",
          properties: {
            texts: { type: "array", items: { type: "string" } },
            model: { type: "string" },
          },
          required: ["texts"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = generateEmbeddingsArgs.parse(args);
        const embeddings = await generateEmbeddings(parsed.texts);
        return JSON.stringify({
          count: embeddings.length,
          dimensions: embeddings[0]?.length || 0,
          cached: EMBEDDING_CACHE.size,
        });
      },
    },
    {
      tool: {
        name: "store_document",
        description:
          "Store a document with automatic chunking and embedding. Returns document ID and chunk count.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string", description: "Unique document identifier" },
            title: { type: "string" },
            content: { type: "string" },
            url: { type: "string", format: "uri" },
            metadata: { type: "object" },
            chunkSize: { type: "number" },
            chunkOverlap: { type: "number" },
          },
          required: ["documentId", "title", "content"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = storeDocumentArgs.parse(args);

        // Check if document already exists
        if (vectorStore.documents.has(parsed.documentId)) {
          throw new Error(`Document ${parsed.documentId} already exists`);
        }

        // Chunk the document
        const chunks = chunkTextFixed(parsed.content, parsed.chunkSize, parsed.chunkOverlap);

        // Generate embeddings for all chunks
        const embeddings = await generateEmbeddings(chunks);

        // Store chunks
        const chunkIds: string[] = [];
        for (const [i, text] of chunks.entries()) {
          const chunkId = `chunk-${vectorStore.nextChunkId++}`;
          const chunk: Chunk = {
            id: chunkId,
            documentId: parsed.documentId,
            text,
            index: i,
            embedding: embeddings[i],
          };
          vectorStore.chunks.set(chunkId, chunk);
          chunkIds.push(chunkId);
        }

        // Store document metadata
        const doc: Document = {
          id: parsed.documentId,
          title: parsed.title,
          url: parsed.url,
          addedAt: new Date().toISOString(),
          metadata: parsed.metadata,
          chunkCount: chunks.length,
        };
        vectorStore.documents.set(parsed.documentId, doc);

        // Persist to disk
        await persisVectorStore();

        return JSON.stringify({
          documentId: parsed.documentId,
          title: parsed.title,
          chunkCount: chunks.length,
          message: `Stored document with ${chunks.length} chunks`,
        });
      },
    },
    {
      tool: {
        name: "search_knowledge",
        description: "Search stored documents using semantic similarity.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            topK: { type: "number", minimum: 1, maximum: 20 },
            includeSemanticScore: { type: "boolean" },
          },
          required: ["query"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = searchKnowledgeArgs.parse(args);

        if (vectorStore.chunks.size === 0) {
          return JSON.stringify({
            query: parsed.query,
            results: [],
            message: "No documents in knowledge base",
          });
        }

        // Generate query embedding
        const [queryEmbedding] = await generateEmbeddings([parsed.query]);

        if (!queryEmbedding || queryEmbedding.length === 0) {
          throw new Error("Failed to generate query embedding");
        }

        // Score all chunks
        const scored: Array<{ chunkId: string; chunk: Chunk; score: number }> = [];
        for (const [chunkId, chunk] of vectorStore.chunks) {
          if (chunk.embedding) {
            const score = cosineSimilarity(queryEmbedding, chunk.embedding);
            scored.push({ chunkId, chunk, score });
          }
        }

        // Sort by score and get top-k
        scored.sort((a, b) => b.score - a.score);
        const results = scored.slice(0, parsed.topK).map((item) => ({
          documentId: item.chunk.documentId,
          chunkIndex: item.chunk.index,
          text: item.chunk.text.slice(0, 500),
          score: parsed.includeSemanticScore ? Math.round(item.score * 1000) / 1000 : undefined,
        }));

        return JSON.stringify({
          query: parsed.query,
          resultCount: results.length,
          results,
        });
      },
    },
    {
      tool: {
        name: "list_documents",
        description: "List all stored documents with metadata.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number" },
          },
        },
      },
      handler: async (args: unknown) => {
        const parsed = listDocumentsArgs.parse(args);
        const docs = Array.from(vectorStore.documents.values())
          .slice(0, parsed.limit)
          .map((doc) => ({
            id: doc.id,
            title: doc.title,
            url: doc.url,
            chunkCount: doc.chunkCount,
            addedAt: doc.addedAt,
          }));

        return JSON.stringify({
          documentCount: vectorStore.documents.size,
          documents: docs,
        });
      },
    },
    {
      tool: {
        name: "delete_document",
        description: "Delete a document and all its chunks from the knowledge base.",
        inputSchema: {
          type: "object",
          properties: {
            documentId: { type: "string" },
          },
          required: ["documentId"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = deleteDocumentArgs.parse(args);

        if (!vectorStore.documents.has(parsed.documentId)) {
          throw new Error(`Document ${parsed.documentId} not found`);
        }

        const doc = vectorStore.documents.get(parsed.documentId)!;
        vectorStore.documents.delete(parsed.documentId);

        // Delete all chunks for this document
        let deletedChunks = 0;
        for (const [chunkId, chunk] of vectorStore.chunks) {
          if (chunk.documentId === parsed.documentId) {
            vectorStore.chunks.delete(chunkId);
            deletedChunks++;
          }
        }

        await persisVectorStore();

        return JSON.stringify({
          documentId: parsed.documentId,
          title: doc.title,
          deletedChunks,
          message: `Deleted document and ${deletedChunks} chunks`,
        });
      },
    },
    {
      tool: {
        name: "extract_pdf_text",
        description: "Extract text from a PDF file.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            maxPages: { type: "number" },
          },
          required: ["filePath"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = extractPdfArgs.parse(args);
        const text = await extractPdfText(parsed.filePath, parsed.maxPages);
        return JSON.stringify({
          filePath: parsed.filePath,
          extractedChars: text.length,
          preview: text.slice(0, 200),
        });
      },
    },
    {
      tool: {
        name: "extract_docx_text",
        description: "Extract text from a DOCX file.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
          },
          required: ["filePath"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = extractDocxArgs.parse(args);
        const text = await extractDocxText(parsed.filePath);
        return JSON.stringify({
          filePath: parsed.filePath,
          extractedChars: text.length,
          preview: text.slice(0, 200),
        });
      },
    },
    {
      tool: {
        name: "extract_markdown",
        description: "Extract and clean text from a Markdown file.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string" },
          },
          required: ["filePath"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = extractMarkdownArgs.parse(args);
        const text = await extractMarkdownText(parsed.filePath);
        return JSON.stringify({
          filePath: parsed.filePath,
          extractedChars: text.length,
          preview: text.slice(0, 200),
        });
      },
    },
    {
      tool: {
        name: "ingest_webpage",
        description:
          "High-level tool to fetch, render, and store a webpage. Combines fetch_page_rendered + store_document.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
            documentId: { type: "string", description: "Unique identifier for this document" },
            title: { type: "string", description: "Title for the document" },
            chunkSize: { type: "number", optional: true },
            chunkOverlap: { type: "number", optional: true },
          },
          required: ["url", "documentId", "title"],
        },
      },
      handler: async (args: unknown) => {
        const parsed = z
          .object({
            url: z.string().url(),
            documentId: z.string(),
            title: z.string(),
            chunkSize: z.number().optional(),
            chunkOverlap: z.number().optional(),
          })
          .parse(args);

        try {
          const content = (await fetchWebpageContent(parsed.url)).slice(0, 20000);

          // Store in knowledge base
          const storeResult = await (async () => {
            const docArgs = {
              documentId: parsed.documentId,
              title: parsed.title,
              content,
              url: parsed.url,
              metadata: { source: "webpage", ingestedAt: new Date().toISOString() },
              chunkSize: parsed.chunkSize,
              chunkOverlap: parsed.chunkOverlap,
            };

            // Check if document already exists
            if (vectorStore.documents.has(parsed.documentId)) {
              throw new Error(`Document ${parsed.documentId} already exists`);
            }

            // Chunk the document
            const chunkSize = parsed.chunkSize ?? 1000;
            const chunkOverlap = parsed.chunkOverlap ?? 200;
            const chunks = chunkTextFixed(content, chunkSize, chunkOverlap);

            // Generate embeddings for all chunks
            const embeddings = await generateEmbeddings(chunks);

            // Store chunks
            const chunkIds: string[] = [];
            for (const [i, text] of chunks.entries()) {
              const chunkId = `chunk-${vectorStore.nextChunkId++}`;
              const chunk: Chunk = {
                id: chunkId,
                documentId: parsed.documentId,
                text,
                index: i,
                embedding: embeddings[i],
              };
              vectorStore.chunks.set(chunkId, chunk);
              chunkIds.push(chunkId);
            }

            // Store document metadata
            const doc: Document = {
              id: parsed.documentId,
              title: parsed.title,
              url: parsed.url,
              addedAt: new Date().toISOString(),
              metadata: docArgs.metadata,
              chunkCount: chunks.length,
            };
            vectorStore.documents.set(parsed.documentId, doc);

            // Persist to disk
            await persisVectorStore();

            return {
              documentId: parsed.documentId,
              title: parsed.title,
              chunkCount: chunks.length,
              contentLength: content.length,
            };
          })();

          return JSON.stringify({
            success: true,
            url: parsed.url,
            documentId: storeResult.documentId,
            title: storeResult.title,
            chunks: storeResult.chunkCount,
            chars: storeResult.contentLength,
            message: `Successfully ingested webpage: ${storeResult.title} (${storeResult.chunkCount} chunks)`,
          });
        } catch (error) {
          throw new Error(
            `Webpage ingestion failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    },
  ]);
}

// Cleanup on shutdown
async function cleanup(): Promise<void> {
  console.log("[RAG] Persisting vector store...");
  await persisVectorStore();
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

main().catch((error) => {
  console.error("[RAG] Fatal error:", error);
  process.exit(1);
});
