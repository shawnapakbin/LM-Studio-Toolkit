// Feature: codebase-cleanup-plugin-registration, Property 6: Normalization equivalence and idempotence
//
// Property 6: Normalization equivalence and idempotence
//   For canonical `ToolCall` objects, JSON strings with `tool_name` + `input_params`,
//   and legacy `<tool_call>` XML-like strings, the normalized output produced via the
//   AgentRunner, SubAgent, and AskUser entry-point adapters is identical across all
//   three; and `normalizeToolCall` is idempotent on already-canonical inputs.
//
// Validates: Requirements 4.1, 4.2, 4.3
// Design: Property 6
//
// Uses the installed `fast-check` library (>=100 iterations). Not hand-rolled.

import fc from "fast-check";
// Real SubAgent entry-point adapter — the unified `normalizeToolCalls` that routes
// each ToolCallRequest through the shared `normalizeToolCall`.
import { normalizeToolCalls } from "../SubAgent/src/session-pool-helpers";
import { normalizeToolCall } from "./toolCallNormalizer";
import type { ToolCall } from "./types";

const NUM_RUNS = 200; // >= 100 iterations as required.

/**
 * AgentRunner entry-point adapter (reference integration).
 * Mirrors `AgentRunner/src/runner.ts`, which calls the shared normalizer directly:
 *   `normalizeToolCall(step.input, { taskRunId: step.id })`.
 */
function agentRunnerAdapter(raw: unknown, taskRunId: string): ToolCall {
  return normalizeToolCall(raw, { taskRunId });
}

/**
 * SubAgent entry-point adapter.
 * Mirrors `SubAgent/src/session-pool-helpers.ts` `normalizeToolCalls`, which adapts a
 * `ToolCallRequest` into the shared normalizer input, then back to the request shape.
 * For equivalence we feed the same raw canonical payload through the real function and
 * reconstruct the canonical `ToolCall` from its output.
 */
function subAgentAdapter(raw: ToolCall, taskRunId: string): ToolCall {
  const [request] = normalizeToolCalls(
    [
      {
        id: raw.id,
        type: "function" as const,
        function: { name: raw.tool_name, arguments: raw.input_params },
      },
    ],
    taskRunId,
  );
  // Adapt the ToolCallRequest back into a canonical ToolCall for comparison.
  return normalizeToolCall(
    {
      id: request.id,
      task_run_id: taskRunId,
      tool_name: request.function.name,
      input_params: request.function.arguments,
      output_result: "",
      success: false,
      timestamp: raw.timestamp,
    },
    { taskRunId },
  );
}

/**
 * AskUser entry-point adapter.
 * Mirrors `AskUser/src/mcp-server.ts`, whose sole path builds a canonical
 * `{ tool_name, input_params }` envelope and calls the shared `normalizeToolCall`.
 * The essential normalization behavior is the shared-utility call; we route the same
 * raw canonical payload through it exactly as the AskUser handler does.
 */
function askUserAdapter(raw: ToolCall, taskRunId: string): ToolCall {
  return normalizeToolCall(
    {
      id: raw.id,
      task_run_id: taskRunId,
      tool_name: raw.tool_name,
      input_params: raw.input_params,
      output_result: "",
      success: false,
      timestamp: raw.timestamp,
    },
    { taskRunId },
  );
}

/** Compare two ToolCall objects on their canonical (semantically meaningful) fields. */
function canonicalEqual(a: ToolCall, b: ToolCall): boolean {
  return (
    a.tool_name === b.tool_name &&
    a.input_params === b.input_params &&
    a.task_run_id === b.task_run_id
  );
}

// Generators for the meaningful pieces of a canonical tool call.
const toolNameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,20}$/).filter((s) => s.length > 0);
const paramKeyArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,15}$/).filter((s) => s.length > 0);
// Legacy XML extraction only captures the text up to the next '<'; keep values simple.
const paramValueArb = fc
  .stringMatching(/^[A-Za-z0-9 ._-]{1,30}$/)
  .filter((s) => s.trim().length > 0 && s.trim() === s);
const taskRunIdArb = fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/).filter((s) => s.length > 0);

describe("Property 6: Normalization equivalence and idempotence", () => {
  it("produces identical canonical output across AgentRunner, SubAgent, and AskUser adapters for canonical ToolCall objects", () => {
    fc.assert(
      fc.property(
        toolNameArb,
        paramKeyArb,
        paramValueArb,
        taskRunIdArb,
        (name, k, v, taskRunId) => {
          const canonical: ToolCall = {
            id: "",
            task_run_id: taskRunId,
            tool_name: name,
            input_params: JSON.stringify({ [k]: v }),
            output_result: "",
            success: false,
            timestamp: new Date().toISOString(),
          };

          const viaAgentRunner = agentRunnerAdapter(canonical, taskRunId);
          const viaSubAgent = subAgentAdapter(canonical, taskRunId);
          const viaAskUser = askUserAdapter(canonical, taskRunId);

          expect(canonicalEqual(viaAgentRunner, viaSubAgent)).toBe(true);
          expect(canonicalEqual(viaSubAgent, viaAskUser)).toBe(true);
          expect(viaAgentRunner.tool_name).toBe(name);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("produces identical canonical output across all three adapters for JSON strings with tool_name + input_params", () => {
    fc.assert(
      fc.property(
        toolNameArb,
        paramKeyArb,
        paramValueArb,
        taskRunIdArb,
        (name, k, v, taskRunId) => {
          const inputParams = JSON.stringify({ [k]: v });
          const jsonString = JSON.stringify({
            id: "",
            task_run_id: taskRunId,
            tool_name: name,
            input_params: inputParams,
            output_result: "",
            success: false,
            timestamp: new Date().toISOString(),
          });

          // AgentRunner routes the raw JSON string directly through the shared normalizer.
          const viaAgentRunner = agentRunnerAdapter(jsonString, taskRunId);
          // The canonical form recovered from the JSON string is what SubAgent/AskUser
          // adapters route through their request/envelope wrappers.
          const recovered = normalizeToolCall(jsonString, { taskRunId });
          const viaSubAgent = subAgentAdapter(recovered, taskRunId);
          const viaAskUser = askUserAdapter(recovered, taskRunId);

          expect(canonicalEqual(viaAgentRunner, viaSubAgent)).toBe(true);
          expect(canonicalEqual(viaSubAgent, viaAskUser)).toBe(true);
          expect(viaAgentRunner.tool_name).toBe(name);
          expect(viaAgentRunner.input_params).toBe(inputParams);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("produces identical canonical output across all three adapters for legacy <tool_call> XML-like strings", () => {
    fc.assert(
      fc.property(
        toolNameArb,
        paramKeyArb,
        paramValueArb,
        taskRunIdArb,
        (name, k, v, taskRunId) => {
          const value = v.trim();
          const legacyXml = `<tool_call><function=${name}><parameter=${k}>${value}</parameter></function></tool_call>`;

          // AgentRunner routes the raw legacy XML string directly through the normalizer.
          const viaAgentRunner = agentRunnerAdapter(legacyXml, taskRunId);
          // SubAgent/AskUser adapters operate on the canonical form recovered from the XML.
          const recovered = normalizeToolCall(legacyXml, { taskRunId });
          const viaSubAgent = subAgentAdapter(recovered, taskRunId);
          const viaAskUser = askUserAdapter(recovered, taskRunId);

          expect(canonicalEqual(viaAgentRunner, viaSubAgent)).toBe(true);
          expect(canonicalEqual(viaSubAgent, viaAskUser)).toBe(true);
          expect(viaAgentRunner.tool_name).toBe(name);
          expect(viaAgentRunner.task_run_id).toBe(taskRunId);
          expect(JSON.parse(viaAgentRunner.input_params)).toEqual({ [k]: value });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is idempotent: normalizing an already-canonical ToolCall yields an equal canonical result", () => {
    fc.assert(
      fc.property(
        toolNameArb,
        paramKeyArb,
        paramValueArb,
        taskRunIdArb,
        (name, k, v, taskRunId) => {
          const canonical: ToolCall = {
            id: "abc",
            task_run_id: taskRunId,
            tool_name: name,
            input_params: JSON.stringify({ [k]: v }),
            output_result: "",
            success: false,
            timestamp: new Date().toISOString(),
          };

          const once = normalizeToolCall(canonical, { taskRunId });
          const twice = normalizeToolCall(once, { taskRunId });

          expect(canonicalEqual(once, twice)).toBe(true);
          // Idempotent identity on the whole object for already-canonical input.
          expect(twice).toEqual(once);
          expect(once).toEqual(canonical);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
