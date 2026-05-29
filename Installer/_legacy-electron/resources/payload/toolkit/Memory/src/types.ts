export interface TaskRun {
  id: string;
  created_at: string;
  user_prompt: string;
  status: "planning" | "executing" | "completed" | "failed";
  outcome?: string;
  tool_calls_count?: number;
  duration_ms?: number;
  trace_id: string;
}

export interface ToolCall {
  id: string;
  task_run_id: string;
  tool_name: string;
  input_params: string;
  output_result: string;
  success: boolean;
  error_code?: string;
  duration_ms?: number;
  timestamp: string;
}

export interface SolutionPattern {
  id: string;
  task_description: string;
  task_hash: string;
  tool_sequence: string;
  success_rate: number;
  uses: number;
  created_at: string;
  last_used: string;
  full_trace: string;
}

export interface Rule {
  id: string;
  rule_type: string;
  pattern: string;
  reason?: string;
  count: number;
  created_at: string;
}

export interface SessionContext {
  id: string;
  created_at: string;
  last_accessed: string;
  user_context?: string;
  recent_files?: string;
  cwd?: string;
}

export interface AgentDecision {
  id: string;
  task_run_id: string;
  step_num: number;
  decision_text: string;
  alternatives?: string;
  confidence: number;
}

export interface FailedAttempt {
  id: string;
  task_run_id: string;
  step_num: number;
  failed_tool: string;
  error_reason: string;
  recovery_attempted?: string;
  recovery_success?: boolean;
}
