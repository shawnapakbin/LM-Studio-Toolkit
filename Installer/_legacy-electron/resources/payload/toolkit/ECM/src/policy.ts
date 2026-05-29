import type {
  AutoCompactNowInput,
  ClearSessionInput,
  DeleteSegmentInput,
  GetSessionPolicyInput,
  ListSegmentsInput,
  RetrieveContextInput,
  SegmentType,
  SetContinuousCompactInput,
  StoreSegmentInput,
  SummarizeSessionInput,
} from "./types";

const VALID_TYPES: SegmentType[] = [
  "conversation_turn",
  "tool_output",
  "document",
  "reasoning",
  "summary",
];

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`'${field}' is required and must be a non-empty string.`);
  }
  return value;
}

export function validateStoreSegment(input: unknown): StoreSegmentInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;

  const sessionId = requireString(i.sessionId, "sessionId");
  const content = requireString(i.content, "content");

  if (!VALID_TYPES.includes(i.type as SegmentType)) {
    throw new Error(`'type' must be one of: ${VALID_TYPES.join(", ")}.`);
  }

  if (i.importance !== undefined) {
    if (typeof i.importance !== "number" || i.importance < 0 || i.importance > 1) {
      throw new Error("'importance' must be a number between 0 and 1.");
    }
  }

  return {
    sessionId,
    type: i.type as SegmentType,
    content,
    importance: typeof i.importance === "number" ? i.importance : 0.5,
    metadata: i.metadata as Record<string, unknown> | undefined,
    includeEmbeddings: typeof i.includeEmbeddings === "boolean" ? i.includeEmbeddings : false,
  };
}

export function validateRetrieveContext(input: unknown): RetrieveContextInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;

  return {
    sessionId: requireString(i.sessionId, "sessionId"),
    query: requireString(i.query, "query"),
    topK: typeof i.topK === "number" ? Math.max(1, Math.floor(i.topK)) : 10,
    maxTokens: typeof i.maxTokens === "number" ? Math.max(1, Math.floor(i.maxTokens)) : 4096,
    minScore: typeof i.minScore === "number" ? i.minScore : undefined,
  };
}

export function validateListSegments(input: unknown): ListSegmentsInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;

  return {
    sessionId: requireString(i.sessionId, "sessionId"),
    limit: typeof i.limit === "number" ? Math.max(1, Math.floor(i.limit)) : 20,
    offset: typeof i.offset === "number" ? Math.max(0, Math.floor(i.offset)) : 0,
    includeEmbeddings: typeof i.includeEmbeddings === "boolean" ? i.includeEmbeddings : false,
  };
}

export function validateDeleteSegment(input: unknown): DeleteSegmentInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;

  return {
    sessionId: requireString(i.sessionId, "sessionId"),
    segmentId: requireString(i.segmentId, "segmentId"),
  };
}

export function validateClearSession(input: unknown): ClearSessionInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;
  return { sessionId: requireString(i.sessionId, "sessionId") };
}

export function validateSummarizeSession(input: unknown): SummarizeSessionInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;

  return {
    sessionId: requireString(i.sessionId, "sessionId"),
    keepNewest: typeof i.keepNewest === "number" ? Math.max(0, Math.floor(i.keepNewest)) : 10,
  };
}

export function validateAutoCompactNow(input: unknown): AutoCompactNowInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;

  return {
    sessionId: requireString(i.sessionId, "sessionId"),
    keepNewest: typeof i.keepNewest === "number" ? Math.max(0, Math.floor(i.keepNewest)) : 10,
  };
}

export function validateSetContinuousCompact(input: unknown): SetContinuousCompactInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;

  if (typeof i.enabled !== "boolean") {
    throw new Error("'enabled' is required and must be a boolean.");
  }

  return {
    sessionId: requireString(i.sessionId, "sessionId"),
    enabled: i.enabled,
    keepNewest:
      typeof i.keepNewest === "number" ? Math.max(1, Math.floor(i.keepNewest)) : undefined,
  };
}

export function validateGetSessionPolicy(input: unknown): GetSessionPolicyInput {
  if (typeof input !== "object" || input === null) throw new Error("Input must be an object.");
  const i = input as Record<string, unknown>;
  return { sessionId: requireString(i.sessionId, "sessionId") };
}
