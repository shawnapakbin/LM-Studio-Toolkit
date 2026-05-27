import crypto from "crypto";
import path from "path";
import {
  ErrorCode,
  type ToolResponse,
  createErrorResponse,
  createSuccessResponse,
} from "@shared/types";
import { toolEndpoint } from "@shared/ports";
import { chunkTextByTokens } from "./chunker";
import { type EmbeddingProvider, createEmbeddingProvider } from "./embeddings";
import {
  normalizeChunkSize,
  normalizeOverlap,
  normalizeTopK,
  validateDeleteInput,
  validateIngestInput,
  validateListInput,
  validateQueryInput,
  validateReindexInput,
} from "./policy";
import { rankChunks } from "./retrieval";
import { RAGStore } from "./store";
import type {
  DeleteSourceInput,
  DocumentInput,
  IngestDocumentsInput,
  ListSourcesInput,
  QueryKnowledgeInput,
  RagRequest,
  ReindexSourceInput,
  SourceType,
} from "./types";

function resolveDbPath(): string {
  const rawDbPath = process.env.RAG_DB_PATH ?? "../rag.db";
  if (rawDbPath === ":memory:") {
    return rawDbPath;
  }
  return path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(__dirname, rawDbPath);
}
const DOC_SCRAPER_ENDPOINT =
  process.env.RAG_DOC_SCRAPER_ENDPOINT ?? `${toolEndpoint("documentscraper")}/tools/read_document`;
const ASK_USER_ENDPOINT =
  process.env.RAG_ASK_USER_ENDPOINT ?? `${toolEndpoint("askuser")}/tools/interview_user`;

const APPROVAL_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

type PendingApprovalToken = {
  action: string;
  expiresAt: number;
  used: boolean;
  scope?: "once" | "session";
  sessionId?: string;
};

// Short-lived approval tokens for the chat-first approval flow (no HTTP dependency).
// Cleared on process restart — intentional; approval context should not persist across restarts.
const pendingApprovalTokens = new Map<string, PendingApprovalToken>();

// Session-scoped grants: sessionId → Set of approved action strings.
// Cleared on process restart — intentional.
const sessionGrants = new Map<string, Set<string>>();

export function clearSessionGrants(sessionId: string): void {
  sessionGrants.delete(sessionId);
}

function addSessionGrant(sessionId: string, action: string): void {
  if (!sessionGrants.has(sessionId)) {
    sessionGrants.set(sessionId, new Set());
  }
  sessionGrants.get(sessionId)!.add(action);
}

function createApprovalToken(
  action: string,
  scope: "once" | "session" = "once",
  sessionId?: string,
): string {
  const token = crypto.randomUUID();
  // Prune stale entries before inserting
  for (const [key, entry] of pendingApprovalTokens.entries()) {
    if (entry.expiresAt <= Date.now() || entry.used) {
      pendingApprovalTokens.delete(key);
    }
  }
  pendingApprovalTokens.set(token, {
    action,
    expiresAt: Date.now() + APPROVAL_TOKEN_TTL_MS,
    used: false,
    scope,
    sessionId,
  });
  return token;
}

function redeemApprovalToken(
  token: string,
  action: string,
  sessionId?: string,
): { ok: true } | { ok: false; reason: string } {
  const entry = pendingApprovalTokens.get(token);
  if (!entry) {
    return { ok: false, reason: "Approval token not found or already used." };
  }
  if (entry.used && entry.scope !== "session") {
    return { ok: false, reason: "Approval token has already been used." };
  }
  if (entry.expiresAt <= Date.now()) {
    pendingApprovalTokens.delete(token);
    return { ok: false, reason: "Approval token has expired. Please request a new one." };
  }
  if (entry.action !== action) {
    return {
      ok: false,
      reason: `Approval token was issued for '${entry.action}', not '${action}'.`,
    };
  }
  if (entry.scope === "session") {
    const sid = sessionId ?? entry.sessionId;
    if (sid) {
      addSessionGrant(sid, action);
    } else {
      // No session context — treat as one-time
      entry.used = true;
    }
  } else {
    entry.used = true;
  }
  return { ok: true };
}

type ApprovalResponse = {
  questionId?: string;
  value?: unknown;
};

type AskUserResponse = {
  interviewId?: string;
  status?: string;
  responses?: ApprovalResponse[];
  data?: {
    interviewId?: string;
    status?: string;
    responses?: ApprovalResponse[];
  };
};

type ScraperResponse = {
  success?: boolean;
  error?: string;
  errorMessage?: string;
  title?: string;
  content?: string;
  data?: {
    title?: string;
    content?: string;
    data?: {
      content?: string;
    };
  };
};

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function inferSourceType(document: DocumentInput): SourceType {
  if (document.url) {
    return "url";
  }
  if (document.filePath) {
    return "file";
  }
  return "text";
}

function inferSourceKey(document: DocumentInput): string {
  return (
    document.sourceKey ||
    document.filePath ||
    document.url ||
    `text:${hashText(document.text || "")}`
  );
}

function pickDocumentText(resultBody: ScraperResponse | undefined): string | undefined {
  if (!resultBody) {
    return undefined;
  }

  const direct = resultBody.content;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const nested = resultBody.data?.content;
  if (typeof nested === "string" && nested.trim()) {
    return nested;
  }

  const nested2 = resultBody.data?.data?.content;
  if (typeof nested2 === "string" && nested2.trim()) {
    return nested2;
  }

  return undefined;
}

function buildApprovalQuestion(action: string, details: string): string {
  return `Approve '${action}' in RAG knowledge base? ${details}`;
}

class RAGService {
  private readonly store: RAGStore;
  private readonly embeddings: EmbeddingProvider;

  constructor(dbPath: string) {
    this.store = new RAGStore(dbPath);
    this.embeddings = createEmbeddingProvider();
  }

  close(): void {
    this.store.close();
  }

  private requestApproval(action: string, details: string, sessionId?: string): ToolResponse {
    const approvalToken = createApprovalToken(action, "once");
    const sessionApprovalToken = sessionId
      ? createApprovalToken(action, "session", sessionId)
      : undefined;
    const question = buildApprovalQuestion(action, details);
    const sessionNote = sessionApprovalToken
      ? ` To allow for the rest of this session, place the sessionApprovalToken value ("${sessionApprovalToken}") into the approvalToken field (same field), and include sessionId.`
      : "";
    return createSuccessResponse({
      status: "approval_required",
      action,
      approvalToken,
      ...(sessionApprovalToken ? { sessionApprovalToken } : {}),
      question,
      message: `User approval is required before this operation can proceed. Ask the user: "${question}" — To allow once: retry with approvalToken: "${approvalToken}" in the approvalToken field.${sessionNote}`,
      instructions:
        "Present the question to the user in chat. On confirmation, call this tool again with the same parameters and EITHER: (a) set approvalToken to the approvalToken value shown above for one-time approval, OR (b) set approvalToken to the sessionApprovalToken value shown above AND include sessionId for session-scoped approval. Both options use the same 'approvalToken' input field — do NOT create a separate 'sessionApprovalToken' input field.",
    });
  }

  private async ensureApproved(
    action: string,
    details: string,
    approvalInterviewId?: string,
    approvalToken?: string,
    sessionId?: string,
  ): Promise<{ ok: true } | { ok: false; response: ToolResponse }> {
    // Session grant check: if this action was previously allowed for this session, skip re-prompt
    if (sessionId && sessionGrants.get(sessionId)?.has(action)) {
      return { ok: true };
    }

    // Env-var bypass: skip approval, log for auditability
    if (process.env.RAG_BYPASS_APPROVAL === "true" || process.env.RAG_BYPASS_APPROVAL === "1") {
      console.error(
        `[RAG] Approval bypassed for '${action}' (RAG_BYPASS_APPROVAL=true) at ${new Date().toISOString()}`,
      );
      return { ok: true };
    }

    // Chat-first token path: no HTTP dependency required
    if (approvalToken) {
      const result = redeemApprovalToken(approvalToken, action, sessionId);
      if (result.ok) {
        return { ok: true };
      }
      return {
        ok: false,
        response: createErrorResponse(ErrorCode.POLICY_BLOCKED, result.reason),
      };
    }

    // AskUser HTTP path: used when the AskUser HTTP server is separately running
    if (approvalInterviewId) {
      let response: Response;
      try {
        response = await fetch(ASK_USER_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get",
            payload: { interviewId: approvalInterviewId },
          }),
        });
      } catch {
        return {
          ok: false,
          response: createErrorResponse(
            ErrorCode.EXECUTION_FAILED,
            `AskUser service is unreachable at ${ASK_USER_ENDPOINT}. Use the chat-first approval flow instead: call without approvalInterviewId to receive an approvalToken, confirm with the user, then retry with that approvalToken.`,
          ),
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          response: createErrorResponse(
            ErrorCode.EXECUTION_FAILED,
            "Unable to verify approval interview via AskUser.",
          ),
        };
      }

      const body = (await response.json()) as AskUserResponse;
      const status = body?.status || body?.data?.status;
      const responses = body?.responses || body?.data?.responses || [];
      const approval = Array.isArray(responses)
        ? responses.find((item) => item?.questionId === "approve")
        : undefined;

      if (status === "answered" && approval?.value === "allow_in_session") {
        if (sessionId) {
          addSessionGrant(sessionId, action);
        }
        return { ok: true };
      }

      if (status === "answered" && approval?.value === true) {
        return { ok: true };
      }

      if (status === "pending") {
        return {
          ok: false,
          response: createSuccessResponse({
            status: "approval_pending",
            action,
            interviewId: approvalInterviewId,
            message: "Approval interview has not been answered yet.",
          }),
        };
      }

      return {
        ok: false,
        response: createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          "Write operation requires explicit approval and was not approved.",
        ),
      };
    }

    // No token or interview ID — initiate the chat-first approval flow
    return {
      ok: false,
      response: this.requestApproval(action, details, sessionId),
    };
  }

  private async resolveText(document: DocumentInput): Promise<{ content: string; title?: string }> {
    if (document.text?.trim()) {
      return { content: document.text.trim(), title: document.title };
    }

    const body: Record<string, unknown> = {};
    if (document.filePath) {
      body.filePath = document.filePath;
    }
    if (document.url) {
      body.url = document.url;
    }

    let response: Response | undefined;
    let payload: ScraperResponse | undefined;
    let content: string | undefined;
    let title: string | undefined;
    let docScraperError: string | undefined;
    try {
      response = await fetch(DOC_SCRAPER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      payload = (await response.json()) as ScraperResponse;
      if (!response.ok || payload?.success === false) {
        docScraperError = payload?.error || payload?.errorMessage || "Document scraping failed.";
      } else {
        content = pickDocumentText(payload);
        title = payload?.title || payload?.data?.title || document.title;
      }
    } catch (_err) {
      docScraperError = `DocumentScraper service is unreachable at ${DOC_SCRAPER_ENDPOINT}. Ensure the DocumentScraper HTTP server is running, or provide document content directly via the 'text' field instead.`;
    }

    // If DocumentScraper failed or returned empty, try Browserless as fallback for dynamic/JS docs
    if ((!content || !content.trim()) && document.url) {
      try {
        // Only fallback for known dynamic/docs domains (can expand this list)
        const dynamicDomains = ["browserless-docs.mcp.kapa.ai", "docs.browserless.io", "kapa.ai"];
        const urlHost = (() => {
          try {
            return new URL(document.url!).host;
          } catch {
            return "";
          }
        })();
        if (dynamicDomains.some((d) => urlHost.endsWith(d))) {
          // Use Browserless content extraction
          const browserlessEndpoint =
            process.env.BROWSERLESS_MCP_ENDPOINT ??
            `${toolEndpoint("csvexporter")}/tools/browserless_content`;
          const browserlessPayload = {
            url: document.url,
            waitForTimeout: 2000,
          };
          const browserlessResp = await fetch(browserlessEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(browserlessPayload),
          });
          type BrowserlessResult = {
            success?: boolean;
            text?: string;
            error?: string;
          };
          const browserlessResult = (await browserlessResp.json()) as BrowserlessResult;
          if (
            browserlessResult.success &&
            browserlessResult.text &&
            browserlessResult.text.trim()
          ) {
            return { content: browserlessResult.text, title: document.title };
          } else {
            throw new Error(
              `Browserless fallback failed: ${browserlessResult.error || "No content extracted."} (status: ${browserlessResp.status})`,
            );
          }
        }
      } catch (err) {
        // If Browserless fallback fails, propagate error below
        docScraperError =
          (docScraperError ? docScraperError + "\n" : "") + `Browserless fallback error: ${err}`;
      }
    }

    if (!content || !content.trim()) {
      throw new Error(
        docScraperError ||
          "Unable to extract document content. If this is a dynamic/JS documentation site, use Browserless BrowserQL to capture content and ingest via text.",
      );
    }

    return { content, title };
  }

  async ingestDocuments(input: IngestDocumentsInput): Promise<ToolResponse> {
    const validationError = validateIngestInput(input);
    if (validationError) {
      return createErrorResponse(ErrorCode.INVALID_INPUT, validationError);
    }

    const approval = await this.ensureApproved(
      "ingest_documents",
      `${input.documents.length} document(s) will be added or updated in persistent knowledge storage.`,
      input.approvalInterviewId,
      input.approvalToken,
      input.sessionId,
    );

    if (!approval.ok) {
      return approval.response;
    }

    const chunkSize = normalizeChunkSize(input.chunkSizeTokens);
    const overlap = normalizeOverlap(input.overlapTokens, chunkSize);

    const results: Array<Record<string, unknown>> = [];

    for (const document of input.documents) {
      const resolved = await this.resolveText(document);
      const sourceKey = inferSourceKey(document);
      const sourceType = inferSourceType(document);
      const chunks = await chunkTextByTokens(resolved.content, this.embeddings, chunkSize, overlap);
      const embeddings = await this.embeddings.embedBatch(chunks.map((chunk) => chunk.content));

      const source = this.store.upsertSource({
        sourceKey,
        sourceType,
        title: resolved.title || document.title,
        metadata: document.metadata,
        fullText: resolved.content,
      });

      this.store.replaceChunks(
        source.id,
        chunks.map((chunk, index) => ({
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embedding: embeddings[index],
          metadata: {
            sourceKey,
            sourceType,
          },
        })),
      );

      results.push({
        sourceId: source.id,
        sourceKey,
        sourceType,
        chunkCount: chunks.length,
        tokenCount: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
      });
    }

    return createSuccessResponse({
      status: "ingested",
      processed: results.length,
      results,
      chunkSizeTokens: chunkSize,
      overlapTokens: overlap,
    });
  }

  async queryKnowledge(input: QueryKnowledgeInput): Promise<ToolResponse> {
    const validationError = validateQueryInput(input);
    if (validationError) {
      return createErrorResponse(ErrorCode.INVALID_INPUT, validationError);
    }

    const topK = normalizeTopK(input.topK);
    const queryVector = (await this.embeddings.embedBatch([input.query]))[0];

    const chunks = this.store.getAllChunks({
      sourceIds: input.sourceIds,
      sourceKeys: input.sourceKeys,
    });

    const results = rankChunks({
      queryEmbedding: queryVector,
      chunks,
      sourcesById: this.store.getSourceMap(),
      topK,
      minScore: input.minScore,
    });

    return createSuccessResponse({
      query: input.query,
      topK,
      results,
    });
  }

  async listSources(input: ListSourcesInput): Promise<ToolResponse> {
    const validationError = validateListInput(input);
    if (validationError) {
      return createErrorResponse(ErrorCode.INVALID_INPUT, validationError);
    }

    const limit = input.limit ? Math.min(Math.floor(input.limit), 200) : 50;
    const offset = input.offset ? Math.max(Math.floor(input.offset), 0) : 0;
    const sources = this.store.listSources(limit, offset);

    return createSuccessResponse({
      totalReturned: sources.length,
      limit,
      offset,
      sources,
    });
  }

  async deleteSource(input: DeleteSourceInput): Promise<ToolResponse> {
    const validationError = validateDeleteInput(input);
    if (validationError) {
      return createErrorResponse(ErrorCode.INVALID_INPUT, validationError);
    }

    const source = this.store.getSourceById(input.sourceId);
    if (!source) {
      return createErrorResponse(ErrorCode.NOT_FOUND, "Source not found.");
    }

    const approval = await this.ensureApproved(
      "delete_source",
      `Source '${source.source_key}' with ${source.chunk_count} chunk(s) will be removed.`,
      input.approvalInterviewId,
      input.approvalToken,
      input.sessionId,
    );

    if (!approval.ok) {
      return approval.response;
    }

    const result = this.store.deleteSource(input.sourceId);

    return createSuccessResponse({
      status: "deleted",
      sourceId: input.sourceId,
      sourceDeleted: result.sourceDeleted,
      chunksDeleted: result.chunksDeleted,
    });
  }

  async reindexSource(input: ReindexSourceInput): Promise<ToolResponse> {
    const validationError = validateReindexInput(input);
    if (validationError) {
      return createErrorResponse(ErrorCode.INVALID_INPUT, validationError);
    }

    const source = this.store.getSourceById(input.sourceId);
    if (!source) {
      return createErrorResponse(ErrorCode.NOT_FOUND, "Source not found.");
    }

    const approval = await this.ensureApproved(
      "reindex_source",
      `Source '${source.source_key}' will be re-chunked and re-embedded.`,
      input.approvalInterviewId,
      input.approvalToken,
      input.sessionId,
    );

    if (!approval.ok) {
      return approval.response;
    }

    const sourceText = source.source_text as string;
    if (!sourceText || !sourceText.trim()) {
      return createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        "Source content is unavailable for reindex.",
      );
    }

    const chunkSize = normalizeChunkSize(input.chunkSizeTokens);
    const overlap = normalizeOverlap(input.overlapTokens, chunkSize);
    const chunks = await chunkTextByTokens(sourceText, this.embeddings, chunkSize, overlap);
    const vectors = await this.embeddings.embedBatch(chunks.map((chunk) => chunk.content));

    this.store.replaceChunks(
      source.id,
      chunks.map((chunk, index) => ({
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: vectors[index],
        metadata: {
          sourceKey: source.source_key,
          reindexedAt: new Date().toISOString(),
        },
      })),
    );

    return createSuccessResponse({
      status: "reindexed",
      sourceId: source.id,
      sourceKey: source.source_key,
      chunkCount: chunks.length,
      chunkSizeTokens: chunkSize,
      overlapTokens: overlap,
    });
  }
}

let service: RAGService | null = null;
let serviceDbPath: string | null = null;

function getService(): RAGService {
  const dbPath = resolveDbPath();
  if (!service || serviceDbPath !== dbPath) {
    service?.close();
    service = new RAGService(dbPath);
    serviceDbPath = dbPath;
  }
  return service;
}

export function closeService(): void {
  service?.close();
  service = null;
  serviceDbPath = null;
}

export async function handleRAGRequest(request: RagRequest): Promise<ToolResponse> {
  if (!request || !request.action || !request.payload) {
    return createErrorResponse(
      ErrorCode.INVALID_INPUT,
      "Request must contain 'action' and 'payload'.",
    );
  }

  try {
    if (request.action === "ingest_documents") {
      return await getService().ingestDocuments(request.payload as IngestDocumentsInput);
    }

    if (request.action === "query_knowledge") {
      return await getService().queryKnowledge(request.payload as QueryKnowledgeInput);
    }

    if (request.action === "list_sources") {
      return await getService().listSources(request.payload as ListSourcesInput);
    }

    if (request.action === "delete_source") {
      return await getService().deleteSource(request.payload as DeleteSourceInput);
    }

    if (request.action === "reindex_source") {
      return await getService().reindexSource(request.payload as ReindexSourceInput);
    }

    return createErrorResponse(ErrorCode.INVALID_INPUT, `Unsupported action '${request.action}'.`);
  } catch (error) {
    return createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      error instanceof Error ? error.message : String(error),
    );
  }
}
