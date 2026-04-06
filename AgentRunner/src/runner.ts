/**
 * Agent Runner - Orchestrates multi-step workflows with retry and fallback logic
 */

import { ErrorCode, OperationTimer, generateTraceId } from "@shared/types";
import { type Logger, getLogger } from "llm-toolkit-observability";
import { type MetricsRegistry, getRegistry } from "llm-toolkit-observability";
import { SpanStatus, type Tracer, getTracer } from "llm-toolkit-observability";
import { normalizeToolCall } from "../../shared/toolCallNormalizer";
import { type ToolRegistry, ToolStatus } from "./registry";

/**
 * Execution mode for workflow steps
 */
export enum ExecutionMode {
  /** Execute steps one after another */
  SEQUENTIAL = "sequential",
  /** Execute all steps concurrently */
  PARALLEL = "parallel",
}

/**
 * Step retry policy
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelayMs: number;
  /** Exponential backoff multiplier (default: 1 = linear) */
  backoffMultiplier?: number;
}

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  /** Unique step identifier */
  id: string;
  /** Tool ID to invoke */
  toolId: string;
  /** Tool endpoint path (e.g., "/tools/run_terminal_command") */
  endpoint: string;
  /** Input parameters for the tool */
  input: Record<string, unknown>;
  /** Step timeout in milliseconds */
  timeoutMs?: number;
  /** Retry policy for this step */
  retryPolicy?: RetryPolicy;
  /** Dependencies - step IDs that must complete before this step */
  dependsOn?: string[];
}

/**
 * Workflow definition
 */
export interface Workflow {
  /** Workflow identifier */
  id: string;
  /** Workflow name */
  name: string;
  /** Workflow description */
  description?: string;
  /** Execution mode */
  mode: ExecutionMode;
  /** Workflow steps */
  steps: WorkflowStep[];
  /** Global timeout for entire workflow */
  timeoutMs?: number;
}

/**
 * Ambiguity analysis result for a user prompt.
 */
export interface AmbiguityAnalysis {
  ambiguous: boolean;
  reasons: string[];
}

/**
 * Options for generating a clarification interview workflow.
 */
export interface ClarificationWorkflowOptions {
  taskRunId?: string;
  expiresInSeconds?: number;
  title?: string;
  endpoint?: string;
  timeoutMs?: number;
}

/**
 * Parsed approval information from a blocked step/tool response.
 */
export interface ApprovalBlockContext {
  interviewId?: string;
  action?: string;
  status?: string;
  message?: string;
}

/**
 * Options controlling workflow execution behavior.
 */
export interface WorkflowExecutionOptions {
  /** Optional session identifier used for session-scoped behavior. */
  sessionId?: string;
  /** If true, generate an AskUser follow-up workflow when approval blocks execution. */
  autoGenerateApprovalFollowUp?: boolean;
  /** Optional override for auto-approve behavior for this execution only. */
  autoApproveWrites?: boolean;
  /** Expiry for generated follow-up interview checks. */
  followUpExpiresInSeconds?: number;
}

/**
 * Step execution result
 */
export interface StepResult {
  /** Step ID */
  stepId: string;
  /** Tool ID used */
  toolId: string;
  /** Execution success status */
  success: boolean;
  /** Error code if failed */
  errorCode?: ErrorCode;
  /** Error message if failed */
  errorMessage?: string;
  /** Result data */
  data?: {
    status?: unknown;
    action?: unknown;
    interviewId?: unknown;
    message?: unknown;
    data?: Record<string, unknown>;
  };
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Number of retry attempts made */
  retries: number;
  /** Trace ID for this step */
  traceId: string;
  /** Timestamp when step started */
  startedAt: Date;
  /** Timestamp when step completed */
  completedAt: Date;
}

/**
 * Workflow execution result
 */
export interface WorkflowResult {
  /** Workflow ID */
  workflowId: string;
  /** Overall success status */
  success: boolean;
  /** Step results */
  steps: StepResult[];
  /** Total execution duration */
  durationMs: number;
  /** Trace ID for the workflow run */
  traceId: string;
  /** Timestamp when workflow started */
  startedAt: Date;
  /** Timestamp when workflow completed */
  completedAt: Date;
  /** Error summary if workflow failed */
  error?: string;
  /** Auto-generated follow-up workflow for approval-gated steps, if needed. */
  followUpWorkflow?: Workflow;
  /** Parsed approval block context for the failed step, if available. */
  approvalBlock?: ApprovalBlockContext;
  /** Indicates execution auto-approved and retried at least one blocked write. */
  autoApproved?: boolean;
}

/**
 * Agent Runner - Executes workflows with retry and fallback logic
 */
export class AgentRunner {
  private registry: ToolRegistry;
  private activeWorkflows: Map<string, AbortController> = new Map();
  private sessionAutoApprove: Map<string, boolean> = new Map();
  private logger: Logger;
  private metrics: MetricsRegistry;
  private tracer: Tracer;
  private executionCounter;
  private durationHistogram;
  private stepCounter;
  private stepDurationHistogram;
  private static readonly BLOCKED_STEP_STATUSES = new Set([
    "approval_required",
    "approval_pending",
  ]);
  private static readonly AMBIGUITY_PATTERNS: RegExp[] = [
    /\bfix\s+this\b/i,
    /\bmake\s+it\s+better\b/i,
    /\bimprove\s+this\b/i,
    /\bdo\s+something\b/i,
    /\bwhatever\b/i,
    /\bquick\s+fix\b/i,
    /\basap\b/i,
    /\burgent\b/i,
  ];

  constructor(registry: ToolRegistry, logger?: Logger, metrics?: MetricsRegistry, tracer?: Tracer) {
    this.registry = registry;
    this.logger = logger || getLogger();
    this.metrics = metrics || getRegistry();
    this.tracer = tracer || getTracer();

    // Register metrics
    this.executionCounter = this.metrics.counter(
      "workflow_executions_total",
      "Total workflow executions",
    );
    this.durationHistogram = this.metrics.histogram(
      "workflow_duration_ms",
      "Workflow execution duration",
    );
    this.stepCounter = this.metrics.counter(
      "workflow_step_executions_total",
      "Total workflow step executions",
    );
    this.stepDurationHistogram = this.metrics.histogram(
      "workflow_step_duration_ms",
      "Workflow step execution duration",
    );
  }

  /**
   * Analyze whether a prompt likely needs user clarification before execution.
   */
  analyzePromptAmbiguity(prompt: string): AmbiguityAnalysis {
    const reasons: string[] = [];
    const normalized = prompt.trim();

    if (!normalized) {
      return {
        ambiguous: true,
        reasons: ["Prompt is empty."],
      };
    }

    if (normalized.length < 20) {
      reasons.push("Prompt is very short and may lack detail.");
    }

    for (const pattern of AgentRunner.AMBIGUITY_PATTERNS) {
      if (pattern.test(normalized)) {
        reasons.push(`Prompt matches ambiguous phrase '${pattern.source}'.`);
      }
    }

    const hasConstraintSignals =
      /\b(without|must|should|acceptance|deadline|priority|scope)\b/i.test(normalized);
    if (!hasConstraintSignals) {
      reasons.push("Prompt does not include clear constraints or acceptance criteria.");
    }

    return {
      ambiguous: reasons.length > 0,
      reasons,
    };
  }

  /**
   * Build a one-step clarification interview workflow using the AskUser tool.
   */
  buildClarificationWorkflow(prompt: string, options?: ClarificationWorkflowOptions): Workflow {
    const endpoint = options?.endpoint || "/tools/ask_user_interview";
    const interviewTitle = options?.title || "Clarify task before execution";

    return {
      id: `clarify-${Date.now()}`,
      name: "Clarification Interview",
      description: "Collects missing requirements and constraints before main workflow execution.",
      mode: ExecutionMode.SEQUENTIAL,
      steps: [
        {
          id: "ask-user-create",
          toolId: "ask-user",
          endpoint,
          timeoutMs: options?.timeoutMs ?? 10000,
          input: {
            action: "create",
            payload: {
              title: interviewTitle,
              taskRunId: options?.taskRunId,
              expiresInSeconds: options?.expiresInSeconds,
              questions: [
                {
                  id: "goal",
                  type: "text",
                  prompt: `What is the exact expected outcome for this request? Original request: ${prompt}`,
                  required: true,
                  minLength: 8,
                  maxLength: 800,
                },
                {
                  id: "scope",
                  type: "single_choice",
                  prompt: "What scope should be targeted?",
                  required: true,
                  options: [
                    { id: "minimal", label: "Minimal change" },
                    { id: "balanced", label: "Balanced implementation" },
                    { id: "full", label: "Complete implementation" },
                  ],
                },
                {
                  id: "constraints",
                  type: "multi_choice",
                  prompt: "Which constraints are mandatory?",
                  minSelections: 0,
                  maxSelections: 5,
                  options: [
                    { id: "no_new_deps", label: "No new dependencies" },
                    { id: "backward_compatible", label: "Backward compatible API" },
                    { id: "tests_required", label: "Tests must be added/updated" },
                    { id: "docs_required", label: "Docs updates required" },
                    { id: "fast_delivery", label: "Fastest delivery preferred" },
                  ],
                },
                {
                  id: "deadline_days",
                  type: "number",
                  prompt: "Desired completion timeline in days?",
                  min: 0,
                  max: 365,
                  integerOnly: true,
                },
                {
                  id: "approval",
                  type: "confirm",
                  prompt: "Proceed with implementation after this clarification?",
                  required: true,
                },
              ],
            },
          },
        },
      ],
    };
  }

  /**
   * Enable or disable auto-approving approval-gated writes for a given session.
   */
  setSessionAutoApprove(sessionId: string, enabled: boolean): void {
    if (!sessionId.trim()) {
      return;
    }

    this.sessionAutoApprove.set(sessionId, enabled);
  }

  /**
   * Read current auto-approve flag for a session.
   */
  getSessionAutoApprove(sessionId: string): boolean {
    return this.sessionAutoApprove.get(sessionId) === true;
  }

  /**
   * Build the next AskUser workflow to continue an approval-gated execution.
   */
  buildApprovalFollowUpWorkflow(
    interviewId: string,
    options?: {
      workflowId?: string;
      blockedStepId?: string;
      expiresInSeconds?: number;
      endpoint?: string;
      timeoutMs?: number;
    },
  ): Workflow {
    const endpoint = options?.endpoint || "/tools/ask_user_interview";

    return {
      id: `approval-followup-${Date.now()}`,
      name: "Approval Follow-up",
      description:
        "Checks AskUser approval interview status so execution can continue with approvalInterviewId.",
      mode: ExecutionMode.SEQUENTIAL,
      steps: [
        {
          id: "ask-user-get-approval",
          toolId: "ask-user",
          endpoint,
          timeoutMs: options?.timeoutMs ?? 10000,
          input: {
            action: "get",
            payload: {
              interviewId,
              workflowId: options?.workflowId,
              blockedStepId: options?.blockedStepId,
              expiresInSeconds: options?.expiresInSeconds,
            },
          },
        },
      ],
    };
  }

  /**
   * Check for tool responses that indicate completion is blocked pending approval.
   */
  private getBlockedStepStatus(data: {
    status?: unknown;
    message?: unknown;
    data?: { status?: unknown; message?: unknown };
  }): { blocked: boolean; message?: string } {
    const topLevelStatus = typeof data.status === "string" ? data.status : undefined;
    const nestedStatus = typeof data.data?.status === "string" ? data.data.status : undefined;
    const status = topLevelStatus || nestedStatus;

    if (status && AgentRunner.BLOCKED_STEP_STATUSES.has(status)) {
      const message =
        (typeof data.message === "string" && data.message) ||
        (typeof data.data?.message === "string" && data.data.message) ||
        `Step is blocked with status '${status}'.`;

      return { blocked: true, message };
    }

    return { blocked: false };
  }

  /**
   * Extract interview and status details from tool response envelopes.
   */
  private extractApprovalBlockContext(data?: {
    status?: unknown;
    action?: unknown;
    interviewId?: unknown;
    message?: unknown;
    data?: {
      status?: unknown;
      action?: unknown;
      interviewId?: unknown;
      message?: unknown;
    };
  }): ApprovalBlockContext {
    if (!data) {
      return {};
    }

    const status =
      typeof data.status === "string"
        ? data.status
        : typeof data.data?.status === "string"
          ? data.data.status
          : undefined;

    const action =
      typeof data.action === "string"
        ? data.action
        : typeof data.data?.action === "string"
          ? data.data.action
          : undefined;

    const interviewId =
      typeof data.interviewId === "string"
        ? data.interviewId
        : typeof data.data?.interviewId === "string"
          ? data.data.interviewId
          : undefined;

    const message =
      typeof data.message === "string"
        ? data.message
        : typeof data.data?.message === "string"
          ? data.data.message
          : undefined;

    return {
      status,
      action,
      interviewId,
      message,
    };
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStepWithRetry(
    step: WorkflowStep,
    retryPolicy?: RetryPolicy,
    workflowTraceId?: string,
  ): Promise<StepResult> {
    const traceId = workflowTraceId || generateTraceId();
    const startedAt = new Date();
    const timer = new OperationTimer();

    // Create child logger for this step
    const stepLogger = this.logger.child(`step-${step.id}`, traceId);

    // Start span for this step
    const spanId = workflowTraceId
      ? this.tracer.startSpan(workflowTraceId, `step-${step.id}`, {
          toolId: step.toolId,
          endpoint: step.endpoint,
        })
      : undefined;

    stepLogger.debug(`Executing step ${step.id}`, { toolId: step.toolId, endpoint: step.endpoint });

    const tool = this.registry.getTool(step.toolId);
    if (!tool) {
      const errorMsg = `Tool ${step.toolId} not found in registry`;
      stepLogger.error(errorMsg, { stepId: step.id });
      if (spanId) this.tracer.endSpan(spanId, SpanStatus.ERROR, { error: errorMsg });
      this.stepCounter.inc({
        toolId: step.toolId,
        status: "error",
        errorCode: ErrorCode.NOT_FOUND,
      });

      return {
        stepId: step.id,
        toolId: step.toolId,
        success: false,
        errorCode: ErrorCode.NOT_FOUND,
        errorMessage: errorMsg,
        durationMs: timer.elapsed(),
        retries: 0,
        traceId,
        startedAt,
        completedAt: new Date(),
      };
    }

    if (tool.status === ToolStatus.UNHEALTHY) {
      const errorMsg = `Tool ${step.toolId} is unhealthy: ${tool.healthError}`;
      stepLogger.warn(errorMsg, { stepId: step.id });
      if (spanId) this.tracer.endSpan(spanId, SpanStatus.ERROR, { error: errorMsg });
      this.stepCounter.inc({ toolId: step.toolId, status: "unhealthy" });

      return {
        stepId: step.id,
        toolId: step.toolId,
        success: false,
        errorCode: ErrorCode.EXECUTION_FAILED,
        errorMessage: `Tool ${step.toolId} is unhealthy: ${tool.healthError}`,
        durationMs: timer.elapsed(),
        retries: 0,
        traceId,
        startedAt,
        completedAt: new Date(),
      };
    }

    const policy = retryPolicy || step.retryPolicy || { maxRetries: 0, retryDelayMs: 1000 };
    let lastError: Error | null = null;
    let lastErrorCode: ErrorCode = ErrorCode.EXECUTION_FAILED;
    let retries = 0;

    // Normalize tool call input before dispatch (ensures canonical format)
    let normalizedInput: Record<string, unknown> = step.input;
    try {
      // Only normalize if input looks like a tool call payload (string/object)
      // and not already canonical (skip if already structured for the tool)
      // We assume normalization is idempotent for canonical input
      normalizedInput = normalizeToolCall(step.input, { taskRunId: step.id });
    } catch (_err) {
      // If normalization fails, fallback to original input (legacy tools may not need normalization)
      normalizedInput = step.input;
    }

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      if (attempt > 0) {
        retries++;
        const delay = policy.retryDelayMs * Math.pow(policy.backoffMultiplier || 1, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const url = `${tool.httpEndpoint}${step.endpoint}`;
        const timeoutMs = step.timeoutMs || 30000;

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalizedInput),
          signal: AbortSignal.timeout(timeoutMs),
        });

        const data = (await response.json()) as {
          success?: boolean;
          ok?: boolean;
          status?: string;
          message?: string;
          errorMessage?: string;
          error?: string;
          data?: { status?: string; message?: string };
        };

        const blocked = this.getBlockedStepStatus(data);
        if (blocked.blocked) {
          const duration = timer.elapsed();
          const blockedMessage = blocked.message || "Step is blocked pending approval.";

          stepLogger.warn(`Step ${step.id} blocked`, {
            toolId: step.toolId,
            reason: blockedMessage,
            durationMs: duration,
          });

          if (spanId) {
            this.tracer.endSpan(spanId, SpanStatus.CANCELLED, { reason: blockedMessage });
          }

          this.stepCounter.inc({ toolId: step.toolId, status: "blocked" });
          this.stepDurationHistogram.observe(duration);

          return {
            stepId: step.id,
            toolId: step.toolId,
            success: false,
            errorCode: ErrorCode.POLICY_BLOCKED,
            errorMessage: blockedMessage,
            data,
            durationMs: duration,
            retries,
            traceId,
            startedAt,
            completedAt: new Date(),
          };
        }

        // Check if response indicates success
        const isSuccess = response.ok && (data.success === true || data.ok === true);

        if (isSuccess) {
          const duration = timer.elapsed();
          stepLogger.info(`Step ${step.id} completed successfully`, {
            toolId: step.toolId,
            durationMs: duration,
            retries,
          });
          if (spanId) this.tracer.endSpan(spanId, SpanStatus.SUCCESS, { durationMs: duration });
          this.stepCounter.inc({ toolId: step.toolId, status: "success" });
          this.stepDurationHistogram.observe(duration);

          return {
            stepId: step.id,
            toolId: step.toolId,
            success: true,
            data,
            durationMs: timer.elapsed(),
            retries,
            traceId,
            startedAt,
            completedAt: new Date(),
          };
        }

        // Non-successful response - may retry on next iteration
        lastError = new Error(data.errorMessage || data.error || `HTTP ${response.status}`);
        lastErrorCode = ErrorCode.EXECUTION_FAILED;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        lastErrorCode = ErrorCode.EXECUTION_FAILED;
      }
    }

    // All retries exhausted
    const duration = timer.elapsed();
    const errorMsg = lastError?.message || "Step execution failed";
    stepLogger.error(`Step ${step.id} failed after ${retries} retries`, {
      toolId: step.toolId,
      error: errorMsg,
      durationMs: duration,
    });
    if (spanId) this.tracer.endSpan(spanId, SpanStatus.ERROR, { error: errorMsg, retries });
    this.stepCounter.inc({ toolId: step.toolId, status: "error" });
    this.stepDurationHistogram.observe(duration);

    return {
      stepId: step.id,
      toolId: step.toolId,
      success: false,
      errorCode: lastErrorCode,
      errorMessage: lastError?.message || "Unknown error",
      durationMs: timer.elapsed(),
      retries,
      traceId,
      startedAt,
      completedAt: new Date(),
    };
  }

  /**
   * Execute workout steps sequentially
   */
  private async executeSequential(
    workflow: Workflow,
    abortSignal?: AbortSignal,
    workflowTraceId?: string,
    executionOptions?: WorkflowExecutionOptions,
  ): Promise<{
    steps: StepResult[];
    followUpWorkflow?: Workflow;
    approvalBlock?: ApprovalBlockContext;
    autoApproved?: boolean;
  }> {
    const results: StepResult[] = [];
    const completedSteps = new Set<string>();
    const stepOutputs = new Map<string, Record<string, unknown>>(); // Store step outputs for dependencies
    let followUpWorkflow: Workflow | undefined;
    let approvalBlock: ApprovalBlockContext | undefined;
    let autoApproved = false;

    const sessionAutoApproveEnabled = executionOptions?.sessionId
      ? this.getSessionAutoApprove(executionOptions.sessionId)
      : false;
    const autoApproveWrites = executionOptions?.autoApproveWrites ?? sessionAutoApproveEnabled;
    const autoGenerateFollowUp = executionOptions?.autoGenerateApprovalFollowUp ?? true;

    for (const step of workflow.steps) {
      if (abortSignal?.aborted) {
        break;
      }

      // Check dependencies
      const missingDeps = step.dependsOn?.filter((dep) => !completedSteps.has(dep)) || [];
      if (missingDeps.length > 0) {
        results.push({
          stepId: step.id,
          toolId: step.toolId,
          success: false,
          errorCode: ErrorCode.EXECUTION_FAILED,
          errorMessage: `Missing dependencies: ${missingDeps.join(", ")}`,
          durationMs: 0,
          retries: 0,
          traceId: generateTraceId(),
          startedAt: new Date(),
          completedAt: new Date(),
        });
        continue;
      }

      // Merge dependency outputs into step input
      const stepInput = { ...step.input };
      if (step.dependsOn && step.dependsOn.length > 0) {
        for (const depId of step.dependsOn) {
          const depOutput = stepOutputs.get(depId);
          if (depOutput) {
            // Merge dependency output data into input
            Object.assign(stepInput, depOutput);
          }
        }
      }

      // Execute step with merged input
      const stepWithInput = { ...step, input: stepInput };
      const initialResult = await this.executeStepWithRetry(
        stepWithInput,
        undefined,
        workflowTraceId,
      );
      let result = initialResult;
      const followOnResults: StepResult[] = [];

      const blockedByApproval =
        result.success === false && result.errorCode === ErrorCode.POLICY_BLOCKED;
      if (blockedByApproval) {
        const context = this.extractApprovalBlockContext(result.data);
        approvalBlock = context;

        // Session/override-controlled auto-approve for approval-gated writes.
        if (autoApproveWrites && context.interviewId) {
          const approveStep: WorkflowStep = {
            id: `${step.id}__auto_approve`,
            toolId: "ask-user",
            endpoint: "/tools/ask_user_interview",
            timeoutMs: 10000,
            input: {
              action: "submit",
              payload: {
                interviewId: context.interviewId,
                responses: [{ questionId: "approve", value: true }],
              },
            },
          };

          const approveResult = await this.executeStepWithRetry(
            approveStep,
            undefined,
            workflowTraceId,
          );
          followOnResults.push(approveResult);

          if (approveResult.success) {
            const retryStep: WorkflowStep = {
              ...stepWithInput,
              id: `${step.id}__retry_after_approval`,
              input: {
                ...stepWithInput.input,
                approvalInterviewId: context.interviewId,
              },
            };

            const retryResult = await this.executeStepWithRetry(
              retryStep,
              undefined,
              workflowTraceId,
            );
            followOnResults.push(retryResult);

            if (retryResult.success) {
              autoApproved = true;
              result = retryResult;
            } else {
              result = retryResult;
            }
          }
        }

        if (!result.success && autoGenerateFollowUp && context.interviewId) {
          followUpWorkflow = this.buildApprovalFollowUpWorkflow(context.interviewId, {
            workflowId: workflow.id,
            blockedStepId: step.id,
            expiresInSeconds: executionOptions?.followUpExpiresInSeconds,
          });
        }
      }

      const handledByAutoApprove = blockedByApproval && autoApproved && result.success;
      if (!handledByAutoApprove) {
        results.push(initialResult);
      }
      results.push(...followOnResults);

      if (result.success) {
        completedSteps.add(step.id);
        // Store output data for dependent steps
        // Unwrap the response envelope if it has a nested 'data' property
        if (result.data) {
          const outputData =
            result.data.data && typeof result.data.data === "object"
              ? result.data.data
              : result.data;
          stepOutputs.set(step.id, outputData as Record<string, unknown>);
        }
      } else {
        // Stop on first failure in sequential mode
        break;
      }
    }

    return {
      steps: results,
      followUpWorkflow,
      approvalBlock,
      autoApproved,
    };
  }

  /**
   * Execute workflow steps in parallel
   */
  private async executeParallel(
    workflow: Workflow,
    abortSignal?: AbortSignal,
    workflowTraceId?: string,
  ): Promise<StepResult[]> {
    const stepPromises = workflow.steps.map((step) => {
      if (abortSignal?.aborted) {
        return Promise.resolve({
          stepId: step.id,
          toolId: step.toolId,
          success: false,
          errorCode: ErrorCode.EXECUTION_FAILED,
          errorMessage: "Workflow aborted",
          durationMs: 0,
          retries: 0,
          traceId: generateTraceId(),
          startedAt: new Date(),
          completedAt: new Date(),
        });
      }

      return this.executeStepWithRetry(step, undefined, workflowTraceId);
    });

    return await Promise.all(stepPromises);
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflow: Workflow,
    executionOptions?: WorkflowExecutionOptions,
  ): Promise<WorkflowResult> {
    const traceId = this.tracer.startTrace(workflow.id, workflow.name, {
      mode: workflow.mode,
      stepCount: workflow.steps.length,
    });
    const startedAt = new Date();
    const timer = new OperationTimer();

    // Create child logger for this workflow
    const workflowLogger = this.logger.child(`workflow-${workflow.id}`, traceId);

    workflowLogger.info(`Starting workflow ${workflow.id}`, {
      name: workflow.name,
      mode: workflow.mode,
      stepCount: workflow.steps.length,
    });

    const abortController = new AbortController();
    this.activeWorkflows.set(workflow.id, abortController);

    let timedOut = false;

    try {
      // Set global workflow timeout if specified
      let timeoutHandle: NodeJS.Timeout | undefined;
      if (workflow.timeoutMs) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          abortController.abort();
        }, workflow.timeoutMs);
      }

      // Listen for cancellation (signal will handle abortion)
      // If already aborted, execution below will handle it

      let results: StepResult[];
      let followUpWorkflow: Workflow | undefined;
      let approvalBlock: ApprovalBlockContext | undefined;
      let autoApproved = false;

      if (workflow.mode === ExecutionMode.PARALLEL) {
        results = await this.executeParallel(workflow, abortController.signal, traceId);
      } else {
        const sequentialResult = await this.executeSequential(
          workflow,
          abortController.signal,
          traceId,
          executionOptions,
        );
        results = sequentialResult.steps;
        followUpWorkflow = sequentialResult.followUpWorkflow;
        approvalBlock = sequentialResult.approvalBlock;
        autoApproved = sequentialResult.autoApproved === true;
      }

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      // Check if workflow was aborted
      if (abortController.signal.aborted) {
        const error = timedOut
          ? `Workflow timed out after ${workflow.timeoutMs}ms`
          : "Workflow was cancelled";

        const duration = timer.elapsed();
        workflowLogger.warn(`Workflow ${workflow.id} aborted`, { error, durationMs: duration });
        this.tracer.endTrace(traceId, SpanStatus.CANCELLED);
        this.executionCounter.inc({ workflowId: workflow.id, status: "aborted" });
        this.durationHistogram.observe(duration);

        return {
          workflowId: workflow.id,
          success: false,
          steps: results,
          durationMs: timer.elapsed(),
          traceId,
          startedAt,
          completedAt: new Date(),
          error,
          followUpWorkflow,
          approvalBlock,
          autoApproved,
        };
      }

      const success = results.every((r) => r.success);
      const error = success
        ? undefined
        : `Workflow failed: ${results.filter((r) => !r.success).length} of ${results.length} steps failed`;

      const duration = timer.elapsed();

      if (success) {
        workflowLogger.info(`Workflow ${workflow.id} completed successfully`, {
          durationMs: duration,
          stepCount: results.length,
        });
        this.tracer.endTrace(traceId, SpanStatus.SUCCESS);
        this.executionCounter.inc({ workflowId: workflow.id, status: "success" });
      } else {
        workflowLogger.error(`Workflow ${workflow.id} failed`, {
          error,
          durationMs: duration,
          failedSteps: results.filter((r) => !r.success).length,
        });
        this.tracer.endTrace(traceId, SpanStatus.ERROR);
        this.executionCounter.inc({ workflowId: workflow.id, status: "error" });
      }

      this.durationHistogram.observe(duration);

      return {
        workflowId: workflow.id,
        success,
        steps: results,
        durationMs: timer.elapsed(),
        traceId,
        startedAt,
        completedAt: new Date(),
        error,
        followUpWorkflow,
        approvalBlock,
        autoApproved,
      };
    } finally {
      this.activeWorkflows.delete(workflow.id);
    }
  }

  /**
   * Cancel a running workflow
   */
  cancelWorkflow(workflowId: string): boolean {
    const controller = this.activeWorkflows.get(workflowId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Get running workflow IDs
   */
  getRunningWorkflows(): string[] {
    return Array.from(this.activeWorkflows.keys());
  }
}
