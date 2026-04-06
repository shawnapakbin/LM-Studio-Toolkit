import {
  ErrorCode,
  type ToolResponse,
  createErrorResponse,
  createSuccessResponse,
} from "@shared/types";
import {
  validateDefineSkill,
  validateDeleteSkill,
  validateExecuteSkill,
  validateGetSkill,
  validateListSkills,
} from "./policy";
import { DB_PATH, SkillsStore } from "./store";
import type {
  DefineSkillInput,
  DeleteSkillInput,
  DeleteSkillResult,
  ExecuteSkillInput,
  ExecuteSkillResult,
  GetSkillInput,
  ListSkillsInput,
  ParamSchema,
  ResolvedStep,
  SkillListResult,
  SkillRecord,
  Step,
} from "./types";

const store = new SkillsStore(DB_PATH);

/**
 * Replace all {{key}} tokens in template for keys present in params.
 * Unknown tokens are left unchanged.
 */
export function interpolate(template: string, params: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    const token = `{{${key}}}`;
    result = result.split(token).join(String(value));
  }
  return result;
}

/**
 * Resolve all steps by interpolating params into templates and args.
 * Does not mutate the input steps array.
 */
export function resolveSteps(steps: Step[], params: Record<string, unknown>): ResolvedStep[] {
  return steps.map((step) => {
    if (step.type === "prompt") {
      return { type: "prompt", text: interpolate(step.template, params) };
    }
    // tool_call
    const resolvedArgs: Record<string, string> = {};
    for (const [key, val] of Object.entries(step.args)) {
      resolvedArgs[key] = interpolate(val, params);
    }
    return { type: "tool_call", tool: step.tool, args: resolvedArgs };
  });
}

export async function defineSkill(input: DefineSkillInput): Promise<ToolResponse<SkillRecord>> {
  try {
    const validated = validateDefineSkill(input);
    const record = store.upsertSkill(validated);
    return createSuccessResponse(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("'") || message.startsWith("Input") || message.startsWith("Step")) {
      return createErrorResponse(ErrorCode.INVALID_INPUT, message) as ToolResponse<SkillRecord>;
    }
    return createErrorResponse(ErrorCode.EXECUTION_FAILED, message) as ToolResponse<SkillRecord>;
  }
}

export async function executeSkill(
  input: ExecuteSkillInput,
): Promise<ToolResponse<ExecuteSkillResult>> {
  try {
    const validated = validateExecuteSkill(input);
    const skill = store.getSkillByName(validated.name);
    if (!skill) {
      return createErrorResponse(
        ErrorCode.NOT_FOUND,
        `Skill not found: ${validated.name}`,
      ) as ToolResponse<ExecuteSkillResult>;
    }

    const schema = JSON.parse(skill.param_schema_json) as ParamSchema;
    const steps = JSON.parse(skill.steps_json) as Step[];
    const params = validated.params ?? {};

    if (schema.required && schema.required.length > 0) {
      for (const key of schema.required) {
        if (!(key in params)) {
          return createErrorResponse(
            ErrorCode.INVALID_INPUT,
            `Missing required param: ${key}`,
          ) as ToolResponse<ExecuteSkillResult>;
        }
      }
    }

    const resolvedSteps = resolveSteps(steps, params);
    return createSuccessResponse({ skillName: skill.name, resolvedSteps });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("'") || message.startsWith("Input")) {
      return createErrorResponse(
        ErrorCode.INVALID_INPUT,
        message,
      ) as ToolResponse<ExecuteSkillResult>;
    }
    return createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      message,
    ) as ToolResponse<ExecuteSkillResult>;
  }
}

export async function getSkill(input: GetSkillInput): Promise<ToolResponse<SkillRecord>> {
  try {
    const validated = validateGetSkill(input);
    let skill: SkillRecord | undefined;

    if (validated.id) {
      skill = store.getSkillById(validated.id);
    }
    if (!skill && validated.name) {
      skill = store.getSkillByName(validated.name);
    }

    if (!skill) {
      const identifier = validated.id ?? validated.name ?? "unknown";
      return createErrorResponse(
        ErrorCode.NOT_FOUND,
        `Skill not found: ${identifier}`,
      ) as ToolResponse<SkillRecord>;
    }

    return createSuccessResponse(skill);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("At least") || message.startsWith("Input")) {
      return createErrorResponse(ErrorCode.INVALID_INPUT, message) as ToolResponse<SkillRecord>;
    }
    return createErrorResponse(ErrorCode.EXECUTION_FAILED, message) as ToolResponse<SkillRecord>;
  }
}

export async function listSkills(input: ListSkillsInput): Promise<ToolResponse<SkillListResult>> {
  try {
    const validated = validateListSkills(input);
    const limit = validated.limit ?? 20;
    const offset = validated.offset ?? 0;
    const skills = store.listSkills(limit, offset);
    return createSuccessResponse({ skills, total: skills.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("'") || message.startsWith("Input")) {
      return createErrorResponse(ErrorCode.INVALID_INPUT, message) as ToolResponse<SkillListResult>;
    }
    return createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      message,
    ) as ToolResponse<SkillListResult>;
  }
}

export async function deleteSkill(
  input: DeleteSkillInput,
): Promise<ToolResponse<DeleteSkillResult>> {
  try {
    const validated = validateDeleteSkill(input);

    let skill: SkillRecord | undefined;
    if (validated.id) {
      skill = store.getSkillById(validated.id);
    }
    if (!skill && validated.name) {
      skill = store.getSkillByName(validated.name);
    }

    if (!skill) {
      const identifier = validated.id ?? validated.name ?? "unknown";
      return createErrorResponse(
        ErrorCode.NOT_FOUND,
        `Skill not found: ${identifier}`,
      ) as ToolResponse<DeleteSkillResult>;
    }

    store.deleteSkill(skill.id);
    return createSuccessResponse({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("At least") || message.startsWith("Input")) {
      return createErrorResponse(
        ErrorCode.INVALID_INPUT,
        message,
      ) as ToolResponse<DeleteSkillResult>;
    }
    return createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      message,
    ) as ToolResponse<DeleteSkillResult>;
  }
}
