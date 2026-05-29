import type {
  DefineSkillInput,
  DeleteSkillInput,
  ExecuteSkillInput,
  GetSkillInput,
  ListSkillsInput,
  ParamSchema,
  Step,
} from "./types";

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_PLACEHOLDER_RE = /^\w+$/;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_STEPS = 100;

function validateName(name: unknown): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("'name' must be a non-empty string.");
  }
  if (!KEBAB_CASE_RE.test(name)) {
    throw new Error(
      `'name' must be kebab-case (pattern /^[a-z0-9]+(-[a-z0-9]+)*$/), got: "${name}".`,
    );
  }
  return name;
}

function validatePlaceholders(value: string, context: string): void {
  // Extract all {{...}} tokens and validate each placeholder name
  const raw = value.matchAll(/\{\{([^}]*)\}\}/g);
  for (const match of raw) {
    const placeholder = match[1];
    if (!VALID_PLACEHOLDER_RE.test(placeholder)) {
      throw new Error(
        `Invalid placeholder name "{{${placeholder}}}" in ${context}. Placeholder names must match /^\\w+$/.`,
      );
    }
  }
}

function validateStep(step: unknown, index: number): Step {
  if (typeof step !== "object" || step === null) {
    throw new Error(`Step at index ${index} must be an object.`);
  }

  const s = step as Record<string, unknown>;

  if (s.type === "prompt") {
    if (typeof s.template !== "string" || s.template.length === 0) {
      throw new Error(`Step at index ${index} (type 'prompt') must have a non-empty 'template'.`);
    }
    validatePlaceholders(s.template, `step[${index}].template`);
    return { type: "prompt", template: s.template };
  }

  if (s.type === "tool_call") {
    if (typeof s.tool !== "string" || s.tool.length === 0) {
      throw new Error(`Step at index ${index} (type 'tool_call') must have a non-empty 'tool'.`);
    }
    const args: Record<string, string> = {};
    if (s.args !== undefined) {
      if (typeof s.args !== "object" || s.args === null || Array.isArray(s.args)) {
        throw new Error(`Step at index ${index} (type 'tool_call') 'args' must be an object.`);
      }
      for (const [key, val] of Object.entries(s.args as Record<string, unknown>)) {
        if (typeof val !== "string") {
          throw new Error(
            `Step at index ${index} (type 'tool_call') args['${key}'] must be a string.`,
          );
        }
        validatePlaceholders(val, `step[${index}].args['${key}']`);
        args[key] = val;
      }
    }
    return { type: "tool_call", tool: s.tool, args };
  }

  throw new Error(
    `Step at index ${index} has invalid type "${s.type}". Must be 'prompt' or 'tool_call'.`,
  );
}

function validateParamSchema(schema: unknown): ParamSchema {
  if (typeof schema !== "object" || schema === null) {
    throw new Error("'paramSchema' must be an object.");
  }
  const s = schema as Record<string, unknown>;
  if (s.type !== "object") {
    throw new Error("'paramSchema.type' must be 'object'.");
  }
  if (typeof s.properties !== "object" || s.properties === null || Array.isArray(s.properties)) {
    throw new Error("'paramSchema.properties' must be an object.");
  }
  if (s.required !== undefined) {
    if (!Array.isArray(s.required) || !s.required.every((r) => typeof r === "string")) {
      throw new Error("'paramSchema.required' must be an array of strings.");
    }
  }
  return schema as ParamSchema;
}

export function validateDefineSkill(input: unknown): DefineSkillInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be an object.");
  }
  const i = input as Record<string, unknown>;

  const name = validateName(i.name);

  if (typeof i.description !== "string" || i.description.length === 0) {
    throw new Error("'description' must be a non-empty string.");
  }
  if (i.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `'description' must not exceed ${MAX_DESCRIPTION_LENGTH} characters (got ${i.description.length}).`,
    );
  }

  const paramSchema = validateParamSchema(i.paramSchema);

  if (!Array.isArray(i.steps) || i.steps.length === 0) {
    throw new Error("'steps' must be a non-empty array.");
  }
  if (i.steps.length > MAX_STEPS) {
    throw new Error(`'steps' must not exceed ${MAX_STEPS} steps (got ${i.steps.length}).`);
  }

  const steps: Step[] = i.steps.map((step, idx) => validateStep(step, idx));

  return { name, description: i.description, paramSchema, steps };
}

export function validateExecuteSkill(input: unknown): ExecuteSkillInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be an object.");
  }
  const i = input as Record<string, unknown>;

  if (typeof i.name !== "string" || i.name.length === 0) {
    throw new Error("'name' is required and must be a non-empty string.");
  }

  const params =
    i.params !== undefined
      ? (() => {
          if (typeof i.params !== "object" || i.params === null || Array.isArray(i.params)) {
            throw new Error("'params' must be an object.");
          }
          return i.params as Record<string, unknown>;
        })()
      : undefined;

  return { name: i.name, params };
}

export function validateGetSkill(input: unknown): GetSkillInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be an object.");
  }
  const i = input as Record<string, unknown>;

  const hasName = typeof i.name === "string" && i.name.length > 0;
  const hasId = typeof i.id === "string" && i.id.length > 0;

  if (!hasName && !hasId) {
    throw new Error("At least one of 'name' or 'id' must be provided.");
  }

  return {
    name: hasName ? (i.name as string) : undefined,
    id: hasId ? (i.id as string) : undefined,
  };
}

export function validateListSkills(input: unknown): ListSkillsInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be an object.");
  }
  const i = input as Record<string, unknown>;

  let limit: number | undefined;
  if (i.limit !== undefined) {
    if (typeof i.limit !== "number" || !Number.isInteger(i.limit) || i.limit <= 0) {
      throw new Error("'limit' must be a positive integer.");
    }
    limit = i.limit;
  }

  let offset: number | undefined;
  if (i.offset !== undefined) {
    if (typeof i.offset !== "number" || !Number.isInteger(i.offset) || i.offset < 0) {
      throw new Error("'offset' must be a non-negative integer.");
    }
    offset = i.offset;
  }

  return { limit, offset };
}

export function validateDeleteSkill(input: unknown): DeleteSkillInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be an object.");
  }
  const i = input as Record<string, unknown>;

  const hasName = typeof i.name === "string" && i.name.length > 0;
  const hasId = typeof i.id === "string" && i.id.length > 0;

  if (!hasName && !hasId) {
    throw new Error("At least one of 'name' or 'id' must be provided.");
  }

  return {
    name: hasName ? (i.name as string) : undefined,
    id: hasId ? (i.id as string) : undefined,
  };
}
