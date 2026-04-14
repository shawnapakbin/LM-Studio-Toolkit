import { LMStudioClient } from "@lmstudio/sdk";
import type { SegmentRecord } from "./types";

const COMPACTOR_PROMPT_VERSION = "ecm-compactor-v1";

type LLMModel = Awaited<ReturnType<LMStudioClient["llm"]["load"]>>;

export interface CompactorHighlights {
  highlights: string[];
  decisions: string[];
  unresolved: string[];
  next_actions: string[];
  language: string;
  confidence: number;
}

export interface CompactorRunResult {
  ok: boolean;
  summaryText?: string;
  modelId?: string;
  promptVersion: string;
  validationPassed: boolean;
  highlightsCount?: number;
  decisionsCount?: number;
  confidence?: number;
  error?: string;
}

export interface CompactorLLM {
  summarize(segments: SegmentRecord[]): Promise<CompactorRunResult>;
}

class MockCompactorLLM implements CompactorLLM {
  async summarize(segments: SegmentRecord[]): Promise<CompactorRunResult> {
    const snippets = segments
      .slice(0, 6)
      .map((s) => s.content.trim())
      .filter((c) => c.length > 0)
      .map((c) => `- ${truncateLine(c, 140)}`);

    return {
      ok: true,
      summaryText: [
        "Highlights:",
        ...snippets,
        "",
        "Decisions:",
        "- Continue with active plan and keep recent turns.",
        "",
        "Unresolved:",
        "- None explicitly captured.",
        "",
        "Next Actions:",
        "- Continue from latest retained thread context.",
        "",
        "Language: en",
        "Confidence: 0.82",
      ].join("\n"),
      modelId: "mock-compactor",
      promptVersion: COMPACTOR_PROMPT_VERSION,
      validationPassed: true,
      highlightsCount: snippets.length,
      decisionsCount: 1,
      confidence: 0.82,
    };
  }
}

class LMStudioCompactorLLM implements CompactorLLM {
  private client = new LMStudioClient();
  private modelName = process.env.ECM_COMPACTOR_MODEL ?? "qwen2.5-7b-instruct";
  private modelPromise?: Promise<LLMModel>;

  private getModel(): Promise<LLMModel> {
    if (!this.modelPromise) {
      this.modelPromise = this.client.llm.load(this.modelName);
    }
    return this.modelPromise;
  }

  async summarize(segments: SegmentRecord[]): Promise<CompactorRunResult> {
    try {
      const model = await this.getModel();
      const prompt = buildCompactorPrompt(segments);
      const result = await model.complete(prompt).result();
      const parsed = parseCompactorOutput(result.content);
      if (!parsed.ok) {
        return {
          ok: false,
          modelId: this.modelName,
          promptVersion: COMPACTOR_PROMPT_VERSION,
          validationPassed: false,
          error: parsed.error,
        };
      }

      return {
        ok: true,
        modelId: this.modelName,
        summaryText: renderHighlightsSummary(parsed.value),
        promptVersion: COMPACTOR_PROMPT_VERSION,
        validationPassed: true,
        highlightsCount: parsed.value.highlights.length,
        decisionsCount: parsed.value.decisions.length,
        confidence: parsed.value.confidence,
      };
    } catch (err) {
      return {
        ok: false,
        modelId: this.modelName,
        promptVersion: COMPACTOR_PROMPT_VERSION,
        validationPassed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function createCompactorLLM(): CompactorLLM {
  const mode = (process.env.ECM_COMPACTOR_MODE ?? process.env.ECM_EMBEDDINGS_MODE ?? "lmstudio")
    .toLowerCase()
    .trim();
  if (mode === "mock") {
    return new MockCompactorLLM();
  }
  return new LMStudioCompactorLLM();
}

function buildCompactorPrompt(segments: SegmentRecord[]): string {
  const thread = segments
    .map((s, i) => {
      const safe = s.content.replace(/\s+/g, " ").trim();
      return `${i + 1}. [${s.type}] ${truncateLine(safe, 500)}`;
    })
    .join("\n");

  return [
    "You are a memory compactor for an LLM thread.",
    "Return ONLY valid JSON, no markdown, no prose.",
    "Do not invent facts. Preserve only what is present.",
    "Keep original language when possible.",
    "Capture concise highlights needed for continuity.",
    "",
    "Required JSON schema:",
    '{"highlights": string[], "decisions": string[], "unresolved": string[], "next_actions": string[], "language": string, "confidence": number}',
    "",
    "Thread segments:",
    thread,
  ].join("\n");
}

function parseCompactorOutput(
  raw: string,
): { ok: true; value: CompactorHighlights } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Compactor output was not valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Compactor JSON output must be an object." };
  }

  const obj = parsed as Record<string, unknown>;
  const highlights = ensureStringArray(obj.highlights, "highlights");
  const decisions = ensureStringArray(obj.decisions, "decisions");
  const unresolved = ensureStringArray(obj.unresolved, "unresolved");
  const nextActions = ensureStringArray(obj.next_actions, "next_actions");

  if (!highlights.ok || !decisions.ok || !unresolved.ok || !nextActions.ok) {
    const firstError =
      (!highlights.ok && highlights.error) ||
      (!decisions.ok && decisions.error) ||
      (!unresolved.ok && unresolved.error) ||
      (!nextActions.ok && nextActions.error) ||
      "Compactor output arrays were invalid.";
    return { ok: false, error: firstError };
  }

  if (typeof obj.language !== "string" || obj.language.trim().length === 0) {
    return { ok: false, error: "Compactor output 'language' must be a non-empty string." };
  }
  if (typeof obj.confidence !== "number" || Number.isNaN(obj.confidence)) {
    return { ok: false, error: "Compactor output 'confidence' must be numeric." };
  }

  return {
    ok: true,
    value: {
      highlights: highlights.value,
      decisions: decisions.value,
      unresolved: unresolved.value,
      next_actions: nextActions.value,
      language: obj.language.trim(),
      confidence: Math.max(0, Math.min(1, obj.confidence)),
    },
  };
}

function ensureStringArray(
  value: unknown,
  field: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: `Compactor output '${field}' must be an array.` };
  }
  const normalized = value
    .filter((v) => typeof v === "string")
    .map((v) => (v as string).trim())
    .filter((v) => v.length > 0)
    .slice(0, 12);

  if (normalized.length === 0) {
    return { ok: false, error: `Compactor output '${field}' must include at least one entry.` };
  }
  return { ok: true, value: normalized };
}

function renderHighlightsSummary(parsed: CompactorHighlights): string {
  return [
    "Highlights:",
    ...parsed.highlights.map((item) => `- ${item}`),
    "",
    "Decisions:",
    ...parsed.decisions.map((item) => `- ${item}`),
    "",
    "Unresolved:",
    ...parsed.unresolved.map((item) => `- ${item}`),
    "",
    "Next Actions:",
    ...parsed.next_actions.map((item) => `- ${item}`),
    "",
    `Language: ${parsed.language}`,
    `Confidence: ${parsed.confidence.toFixed(2)}`,
  ].join("\n");
}

function truncateLine(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}...`;
}

export function getCompactorPromptVersion(): string {
  return COMPACTOR_PROMPT_VERSION;
}
