import type {
  CreateInterviewInput,
  InterviewQuestion,
  InterviewResponse,
  SubmitResponsesInput,
} from "./types";

export const MAX_QUESTIONS = Number(process.env.ASK_USER_MAX_QUESTIONS ?? 20);
export const MAX_PROMPT_LENGTH = Number(process.env.ASK_USER_MAX_PROMPT_LENGTH ?? 500);
export const MAX_OPTIONS_PER_QUESTION = Number(process.env.ASK_USER_MAX_OPTIONS ?? 30);
export const MAX_TEXT_RESPONSE_LENGTH = Number(
  process.env.ASK_USER_MAX_TEXT_RESPONSE_LENGTH ?? 4000,
);
export const DEFAULT_EXPIRES_SECONDS = Number(process.env.ASK_USER_DEFAULT_EXPIRES_SECONDS ?? 1800);
export const MIN_EXPIRES_SECONDS = 30;
export const MAX_EXPIRES_SECONDS = Number(process.env.ASK_USER_MAX_EXPIRES_SECONDS ?? 86400);

export function normalizeExpiresSeconds(expiresInSeconds?: number): number {
  if (!Number.isFinite(expiresInSeconds)) {
    return DEFAULT_EXPIRES_SECONDS;
  }

  return Math.min(
    Math.max(Math.floor(Number(expiresInSeconds)), MIN_EXPIRES_SECONDS),
    MAX_EXPIRES_SECONDS,
  );
}

function hasDuplicateIds(ids: string[]): boolean {
  return new Set(ids).size !== ids.length;
}

function validateQuestion(question: InterviewQuestion): string | undefined {
  if (!question.id?.trim()) {
    return "Each question requires a non-empty 'id'.";
  }

  if (!question.prompt?.trim()) {
    return `Question '${question.id}' requires a non-empty 'prompt'.`;
  }

  if (question.prompt.length > MAX_PROMPT_LENGTH) {
    return `Question '${question.id}' prompt exceeds max length ${MAX_PROMPT_LENGTH}.`;
  }

  if (question.type === "single_choice" || question.type === "multi_choice") {
    if (!question.options?.length) {
      return `Question '${question.id}' requires at least one option.`;
    }

    if (question.options.length > MAX_OPTIONS_PER_QUESTION) {
      return `Question '${question.id}' exceeds max options ${MAX_OPTIONS_PER_QUESTION}.`;
    }

    if (hasDuplicateIds(question.options.map((option) => option.id))) {
      return `Question '${question.id}' contains duplicate option IDs.`;
    }

    if (question.type === "multi_choice") {
      const minSelections = question.minSelections ?? 0;
      const maxSelections = question.maxSelections ?? question.options.length;
      if (minSelections < 0 || maxSelections < 1 || minSelections > maxSelections) {
        return `Question '${question.id}' has invalid selection constraints.`;
      }
    }
  }

  if (question.type === "text") {
    if ((question.minLength ?? 0) < 0) {
      return `Question '${question.id}' has invalid minLength.`;
    }

    const maxLength = question.maxLength ?? MAX_TEXT_RESPONSE_LENGTH;
    if (maxLength < 1 || (question.minLength ?? 0) > maxLength) {
      return `Question '${question.id}' has invalid text length constraints.`;
    }
  }

  if (question.type === "number") {
    if (
      Number.isFinite(question.min) &&
      Number.isFinite(question.max) &&
      Number(question.min) > Number(question.max)
    ) {
      return `Question '${question.id}' has min greater than max.`;
    }
  }

  return undefined;
}

export function validateCreateInput(input: CreateInterviewInput): string | undefined {
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    return "'questions' must be a non-empty array.";
  }

  if (input.questions.length > MAX_QUESTIONS) {
    return `Maximum ${MAX_QUESTIONS} questions are allowed.`;
  }

  if (hasDuplicateIds(input.questions.map((question) => question.id))) {
    return "Question IDs must be unique.";
  }

  for (const question of input.questions) {
    const questionError = validateQuestion(question);
    if (questionError) {
      return questionError;
    }
  }

  return undefined;
}

function validateResponseAgainstQuestion(
  question: InterviewQuestion,
  response: InterviewResponse,
): string | undefined {
  const value = response.value;

  if (question.type === "text") {
    if (typeof value !== "string") {
      return `Question '${question.id}' expects a text response.`;
    }

    const minLength = question.minLength ?? 0;
    const maxLength = Math.min(
      question.maxLength ?? MAX_TEXT_RESPONSE_LENGTH,
      MAX_TEXT_RESPONSE_LENGTH,
    );
    if (value.length < minLength || value.length > maxLength) {
      return `Question '${question.id}' text length must be ${minLength}-${maxLength}.`;
    }
    return undefined;
  }

  if (question.type === "single_choice") {
    if (typeof value !== "string") {
      return `Question '${question.id}' expects a single option ID.`;
    }

    if (!question.options.some((option) => option.id === value)) {
      return `Question '${question.id}' response contains unknown option '${value}'.`;
    }
    return undefined;
  }

  if (question.type === "multi_choice") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      return `Question '${question.id}' expects an array of option IDs.`;
    }

    const uniqueValues = new Set(value);
    if (uniqueValues.size !== value.length) {
      return `Question '${question.id}' response contains duplicate options.`;
    }

    const minSelections = question.minSelections ?? 0;
    const maxSelections = question.maxSelections ?? question.options.length;
    if (value.length < minSelections || value.length > maxSelections) {
      return `Question '${question.id}' requires ${minSelections}-${maxSelections} selections.`;
    }

    const optionIds = new Set(question.options.map((option) => option.id));
    for (const selectedId of value) {
      if (!optionIds.has(selectedId)) {
        return `Question '${question.id}' response contains unknown option '${selectedId}'.`;
      }
    }

    return undefined;
  }

  if (question.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return `Question '${question.id}' expects a numeric response.`;
    }

    if (question.integerOnly && !Number.isInteger(value)) {
      return `Question '${question.id}' expects an integer response.`;
    }

    if (Number.isFinite(question.min) && value < Number(question.min)) {
      return `Question '${question.id}' requires a value >= ${question.min}.`;
    }

    if (Number.isFinite(question.max) && value > Number(question.max)) {
      return `Question '${question.id}' requires a value <= ${question.max}.`;
    }

    return undefined;
  }

  if (question.type === "confirm") {
    if (typeof value !== "boolean") {
      return `Question '${question.id}' expects a boolean response.`;
    }
    return undefined;
  }

  return "Question has unsupported type.";
}

export function validateSubmitInput(
  input: SubmitResponsesInput,
  questions: InterviewQuestion[],
): string | undefined {
  if (!input.interviewId?.trim()) {
    return "'interviewId' is required.";
  }

  if (!Array.isArray(input.responses) || input.responses.length === 0) {
    return "'responses' must be a non-empty array.";
  }

  if (hasDuplicateIds(input.responses.map((response) => response.questionId))) {
    return "Response question IDs must be unique.";
  }

  const questionMap = new Map(questions.map((question) => [question.id, question]));

  for (const response of input.responses) {
    const question = questionMap.get(response.questionId);
    if (!question) {
      return `Unknown questionId '${response.questionId}'.`;
    }

    const responseError = validateResponseAgainstQuestion(question, response);
    if (responseError) {
      return responseError;
    }
  }

  for (const question of questions) {
    const required = question.required ?? false;
    if (!required) {
      continue;
    }

    const hasResponse = input.responses.some((response) => response.questionId === question.id);
    if (!hasResponse) {
      return `Missing required response for question '${question.id}'.`;
    }
  }

  return undefined;
}
