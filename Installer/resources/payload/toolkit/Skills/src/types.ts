// SkillRecord — DB row + API response
export interface SkillRecord {
  id: string; // UUID v4
  name: string; // kebab-case slug, unique
  description: string;
  param_schema_json: string; // serialized ParamSchema
  steps_json: string; // serialized Step[]
  version: number; // starts at 1, increments on update
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

// ParamSchema
export interface ParamSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

// Step (discriminated union)
export type Step =
  | { type: "prompt"; template: string }
  | { type: "tool_call"; tool: string; args: Record<string, string> };

// ResolvedStep
export type ResolvedStep =
  | { type: "prompt"; text: string }
  | { type: "tool_call"; tool: string; args: Record<string, string> };

// SkillSummary (list_skills item)
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  version: number;
  updatedAt: string;
}

// Input types
export interface DefineSkillInput {
  name: string;
  description: string;
  paramSchema: ParamSchema;
  steps: Step[];
}

export interface ExecuteSkillInput {
  name: string;
  params?: Record<string, unknown>;
}

export interface GetSkillInput {
  name?: string;
  id?: string;
}

export interface ListSkillsInput {
  limit?: number;
  offset?: number;
}

export interface DeleteSkillInput {
  name?: string;
  id?: string;
}

// Result types
export interface ExecuteSkillResult {
  skillName: string;
  resolvedSteps: ResolvedStep[];
}

export interface SkillListResult {
  skills: SkillSummary[];
  total: number;
}

export interface DeleteSkillResult {
  deleted: boolean;
}

// Store input
export interface SkillUpsertInput {
  name: string;
  description: string;
  paramSchema: ParamSchema;
  steps: Step[];
}
