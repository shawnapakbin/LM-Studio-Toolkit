import { validateCreateInput, validateSubmitInput } from "../src/policy";
import type { InterviewQuestion } from "../src/types";

describe("AskUser policy", () => {
  const questions: InterviewQuestion[] = [
    {
      id: "q1",
      type: "text",
      prompt: "What should we build?",
      required: true,
      minLength: 3,
    },
    {
      id: "q2",
      type: "single_choice",
      prompt: "Priority",
      required: true,
      options: [
        { id: "high", label: "High" },
        { id: "low", label: "Low" },
      ],
    },
    {
      id: "q3",
      type: "multi_choice",
      prompt: "Goals",
      options: [
        { id: "speed", label: "Speed" },
        { id: "quality", label: "Quality" },
      ],
      minSelections: 1,
      maxSelections: 2,
    },
    {
      id: "q4",
      type: "number",
      prompt: "Max days",
      min: 1,
      max: 10,
      integerOnly: true,
    },
    {
      id: "q5",
      type: "confirm",
      prompt: "Proceed?",
    },
  ];

  test("accepts valid create input", () => {
    const error = validateCreateInput({ questions });
    expect(error).toBeUndefined();
  });

  test("rejects duplicate question IDs", () => {
    const error = validateCreateInput({
      questions: [questions[0], { ...questions[0] }],
    });

    expect(error).toContain("Question IDs must be unique");
  });

  test("accepts valid submit input", () => {
    const error = validateSubmitInput(
      {
        interviewId: "id-1",
        responses: [
          { questionId: "q1", value: "Build ask user tool" },
          { questionId: "q2", value: "high" },
          { questionId: "q3", value: ["speed"] },
          { questionId: "q4", value: 7 },
          { questionId: "q5", value: true },
        ],
      },
      questions,
    );

    expect(error).toBeUndefined();
  });

  test("rejects unknown option", () => {
    const error = validateSubmitInput(
      {
        interviewId: "id-1",
        responses: [
          { questionId: "q1", value: "Build ask user tool" },
          { questionId: "q2", value: "urgent" },
        ],
      },
      questions,
    );

    expect(error).toContain("unknown option");
  });

  test("rejects missing required response", () => {
    const error = validateSubmitInput(
      {
        interviewId: "id-1",
        responses: [{ questionId: "q1", value: "Build ask user tool" }],
      },
      questions,
    );

    expect(error).toContain("Missing required response");
  });
});
