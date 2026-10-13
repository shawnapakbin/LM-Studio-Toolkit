/**
 * Agent Runner - Main Entry Point
 *
 * Provides orchestration and workflow execution for LLM Toolkit.
 */

export {
  MemoryStore,
  RunRecord,
  SessionContext,
  StepRecord,
} from "./memory";
export {
  defaultRegistry,
  registerDefaultTools,
  ToolCapability,
  ToolMetadata,
  ToolRegistry,
  ToolSchema,
  ToolStatus,
} from "./registry";
export {
  AgentRunner,
  AmbiguityAnalysis,
  ApprovalBlockContext,
  ClarificationWorkflowOptions,
  ExecutionMode,
  RetryPolicy,
  StepResult,
  Workflow,
  WorkflowExecutionOptions,
  WorkflowResult,
  WorkflowStep,
} from "./runner";

import { MemoryStore } from "./memory";
import { defaultRegistry, registerDefaultTools, type ToolRegistry } from "./registry";
import { AgentRunner } from "./runner";

/**
 * Create a fully configured agent runner instance
 */
export function createAgentRunner(options?: {
  registry?: ToolRegistry;
  memoryDbPath?: string;
  autoRegisterTools?: boolean;
  startHealthMonitor?: boolean;
  healthCheckIntervalMs?: number;
}): {
  registry: ToolRegistry;
  runner: AgentRunner;
  memory: MemoryStore;
} {
  const registry = options?.registry || defaultRegistry;

  if (options?.autoRegisterTools !== false) {
    registerDefaultTools(registry);
  }

  if (options?.startHealthMonitor) {
    registry.startHealthCheckMonitor(options.healthCheckIntervalMs);
  }

  const runner = new AgentRunner(registry);
  const memory = new MemoryStore(options?.memoryDbPath);

  return { registry, runner, memory };
}
