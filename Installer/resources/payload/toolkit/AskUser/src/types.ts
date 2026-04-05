export type InterviewStatus = "pending" | "answered" | "expired" | "cancelled";

export type ChoiceOption = {
  id: string;
  label: string;
};

export type BaseQuestion = {
  id: string;
  prompt: string;
  required?: boolean;
};

export type TextQuestion = BaseQuestion & {
  type: "text";
  minLength?: number;
  maxLength?: number;
};

export type SingleChoiceQuestion = BaseQuestion & {
  type: "single_choice";
  options: ChoiceOption[];
};

export type MultiChoiceQuestion = BaseQuestion & {
  type: "multi_choice";
  options: ChoiceOption[];
  minSelections?: number;
  maxSelections?: number;
};

export type NumberQuestion = BaseQuestion & {
  type: "number";
  min?: number;
  max?: number;
  integerOnly?: boolean;
};

export type ConfirmQuestion = BaseQuestion & {
  type: "confirm";
};

export type InterviewQuestion =
  | TextQuestion
  | SingleChoiceQuestion
  | MultiChoiceQuestion
  | NumberQuestion
  | ConfirmQuestion;

export type InterviewResponse = {
  questionId: string;
  value: string | string[] | number | boolean;
};

export type CreateInterviewInput = {
  title?: string;
  taskRunId?: string;
  expiresInSeconds?: number;
  questions: InterviewQuestion[];
};

export type SubmitResponsesInput = {
  interviewId: string;
  responses: InterviewResponse[];
};

export type GetInterviewInput = {
  interviewId: string;
};

export type AskUserAction = "create" | "submit" | "get";

export type AskUserRequest = {
  action: AskUserAction;
  payload: CreateInterviewInput | SubmitResponsesInput | GetInterviewInput;
};
