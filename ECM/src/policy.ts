import type {
  ClearSessionInput,
  GetStatusInput,
  OnUserTurnInput,
  SegmentType,
  StoreSegmentInput,
} from "./types";

const VALID_SEGMENT_TYPES: SegmentType[] = [
  "conversation_turn",
  "tool_output",
  "document",
  "reasoning",
  "summary",
];

export class ValidationError extends Error {
  public readonly code = "INVALID_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  return value;
}

export function validateStoreSegment(input: unknown): StoreSegmentInput {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Input must be an object");
  }
  const i = input as Record<string, unknown>;

  const sessionId = requireNonEmptyString(i.sessionId, "sessionId");
  const content = requireNonEmptyString(i.content, "content");

  const rawType = typeof i.type === "string" ? i.type : "conversation_turn";
  if (!VALID_SEGMENT_TYPES.includes(rawType as SegmentType)) {
    throw new ValidationError(
      `type must be one of: ${VALID_SEGMENT_TYPES.join(", ")} (got: ${rawType})`,
    );
  }
  const type = rawType as SegmentType;

  let importance: number | undefined;
  if (i.importance !== undefined) {
    if (typeof i.importance !== "number" || i.importance < 0 || i.importance > 1) {
      throw new ValidationError("importance must be a number between 0 and 1");
    }
    importance = i.importance;
  }

  let metadata: Record<string, unknown> | undefined;
  if (i.metadata !== undefined) {
    if (!i.metadata || typeof i.metadata !== "object" || Array.isArray(i.metadata)) {
      throw new ValidationError("metadata must be an object");
    }
    metadata = i.metadata as Record<string, unknown>;
  }

  return { sessionId, type, content, importance, metadata };
}

export function validateOnUserTurn(input: unknown): OnUserTurnInput {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Input must be an object");
  }
  const i = input as Record<string, unknown>;

  const sessionId = requireNonEmptyString(i.sessionId, "sessionId");

  let currentUsedTokens: number | undefined;
  if (i.currentUsedTokens !== undefined) {
    if (
      typeof i.currentUsedTokens !== "number" ||
      !Number.isFinite(i.currentUsedTokens) ||
      i.currentUsedTokens < 0
    ) {
      throw new ValidationError("currentUsedTokens must be a non-negative finite number");
    }
    currentUsedTokens = i.currentUsedTokens;
  }

  let contextLimit: number | undefined;
  if (i.contextLimit !== undefined) {
    if (
      typeof i.contextLimit !== "number" ||
      !Number.isFinite(i.contextLimit) ||
      i.contextLimit <= 0
    ) {
      throw new ValidationError("contextLimit must be a positive finite number");
    }
    contextLimit = i.contextLimit;
  }

  let keepNewest: number | undefined;
  if (i.keepNewest !== undefined) {
    if (typeof i.keepNewest !== "number" || !Number.isInteger(i.keepNewest) || i.keepNewest < 0) {
      throw new ValidationError("keepNewest must be a non-negative integer");
    }
    keepNewest = i.keepNewest;
  }

  let threshold: number | undefined;
  if (i.threshold !== undefined) {
    if (typeof i.threshold !== "number" || i.threshold <= 0 || i.threshold > 1) {
      throw new ValidationError("threshold must be a number in (0, 1]");
    }
    threshold = i.threshold;
  }

  let targetRatio: number | undefined;
  if (i.targetRatio !== undefined) {
    if (typeof i.targetRatio !== "number" || i.targetRatio <= 0 || i.targetRatio >= 1) {
      throw new ValidationError("targetRatio must be a number in (0, 1)");
    }
    targetRatio = i.targetRatio;
  }

  return { sessionId, currentUsedTokens, contextLimit, keepNewest, threshold, targetRatio };
}

export function validateClearSession(input: unknown): ClearSessionInput {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Input must be an object");
  }
  const i = input as Record<string, unknown>;
  return { sessionId: requireNonEmptyString(i.sessionId, "sessionId") };
}

export function validateGetStatus(input: unknown): GetStatusInput {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Input must be an object");
  }
  const i = input as Record<string, unknown>;
  return { sessionId: requireNonEmptyString(i.sessionId, "sessionId") };
}
