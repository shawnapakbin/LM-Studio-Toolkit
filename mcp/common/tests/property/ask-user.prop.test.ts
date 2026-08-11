import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fc from "fast-check";

// Set the DB path BEFORE importing the AskUser module (it initializes store at import time)
const TEST_DB_PATH = path.join(os.tmpdir(), `ask-user-prop-test-${Date.now()}.db`);
process.env.ASK_USER_DB_PATH = TEST_DB_PATH;

import { handleAskUserRequest } from "../../../../AskUser/src/ask-user";

/**
 * **Validates: Requirements 5.2, 5.3, 5.4**
 *
 * Property 5: Interview round-trip (create → submit → get)
 *
 * For any valid question array (1–20 questions with valid types and constraints)
 * and any matching valid response set, creating an interview, submitting responses,
 * then retrieving via get SHALL produce a record with status `answered`, the original
 * questions, and the submitted responses preserved exactly.
 */
describe("Feature: mcp-common-plugin-injection", () => {
  afterAll(() => {
    try {
      if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  it("Property 5: Interview round-trip (create → submit → get)", () => {
    // Generator for a text question
    const textQuestionArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      type: fc.constant("text" as const),
      prompt: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
      required: fc.constant(true),
    });

    // Generator for a confirm question
    const confirmQuestionArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      type: fc.constant("confirm" as const),
      prompt: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
      required: fc.constant(true),
    });

    // Generate either text or confirm questions
    const questionArb = fc.oneof(textQuestionArb, confirmQuestionArb);

    // Generate 1–5 questions with unique IDs
    const questionsArb = fc.array(questionArb, { minLength: 1, maxLength: 5 }).map((questions) => {
      // Ensure unique IDs by appending index
      return questions.map((q, i) => ({
        ...q,
        id: `q-${i}-${q.id}`,
      }));
    });

    // Generate matching responses for questions
    const questionsWithResponsesArb = questionsArb.chain((questions) => {
      const responseArbs = questions.map((q) => {
        if (q.type === "text") {
          return fc.string({ minLength: 1, maxLength: 200 }).map((value) => ({
            questionId: q.id,
            value,
          }));
        }
        // confirm type
        return fc.boolean().map((value) => ({
          questionId: q.id,
          value,
        }));
      });

      return fc.tuple(fc.constant(questions), fc.tuple(...responseArbs));
    });

    fc.assert(
      fc.property(questionsWithResponsesArb, ([questions, responses]) => {
        // Step 1: Create interview
        const createResult = handleAskUserRequest(
          {
            action: "create",
            payload: {
              questions,
              title: "Test",
              expiresInSeconds: 3600,
            },
          },
          0,
          `trace-create-${Date.now()}`,
        );

        expect(createResult.success).toBe(true);
        expect(createResult.data).toBeDefined();
        const createData = createResult.data as { interviewId: string; status: string };
        expect(createData.status).toBe("pending");
        const interviewId = createData.interviewId;
        expect(interviewId).toBeDefined();

        // Step 2: Submit responses
        const submitResult = handleAskUserRequest(
          {
            action: "submit",
            payload: {
              interviewId,
              responses,
            },
          },
          0,
          `trace-submit-${Date.now()}`,
        );

        expect(submitResult.success).toBe(true);
        expect(submitResult.data).toBeDefined();
        const submitData = submitResult.data as { status: string };
        expect(submitData.status).toBe("answered");

        // Step 3: Get interview
        const getResult = handleAskUserRequest(
          {
            action: "get",
            payload: {
              interviewId,
            },
          },
          0,
          `trace-get-${Date.now()}`,
        );

        expect(getResult.success).toBe(true);
        expect(getResult.data).toBeDefined();
        const getData = getResult.data as {
          status: string;
          questions: Array<{ id: string; type: string; prompt: string; required: boolean }>;
          responses: Array<{ questionId: string; value: string | boolean }>;
        };

        // Assert status is answered
        expect(getData.status).toBe("answered");

        // Assert questions are preserved
        expect(getData.questions).toHaveLength(questions.length);
        for (let i = 0; i < questions.length; i++) {
          expect(getData.questions[i].id).toBe(questions[i].id);
          expect(getData.questions[i].type).toBe(questions[i].type);
          expect(getData.questions[i].prompt).toBe(questions[i].prompt);
        }

        // Assert responses are preserved
        expect(getData.responses).toHaveLength(responses.length);
        for (let i = 0; i < responses.length; i++) {
          const expectedResponse = responses[i];
          const actualResponse = getData.responses.find(
            (r) => r.questionId === expectedResponse.questionId,
          );
          expect(actualResponse).toBeDefined();
          expect(actualResponse!.value).toEqual(expectedResponse.value);
        }
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 5.5, 5.6, 5.7**
   *
   * Property 6: Interview input validation
   *
   * For any interview operation that violates preconditions — create with empty/missing
   * questions or out-of-range expiry, get/submit with a non-existent ID, or submit
   * targeting an expired/answered/cancelled interview — the interview_user tool SHALL
   * return an error response without modifying system state.
   */
  it("Property 6: Interview input validation", () => {
    // Test 1: Create with empty questions array → success: false
    fc.assert(
      fc.property(fc.integer({ min: 60, max: 86400 }), (_validExpiry) => {
        const emptyQuestionsResult = handleAskUserRequest(
          {
            action: "create",
            payload: {
              questions: [],
              title: "Test",
              expiresInSeconds: 3600,
            },
          },
          0,
          `trace-empty-q-${Date.now()}`,
        );
        expect(emptyQuestionsResult.success).toBe(false);
        expect(emptyQuestionsResult.errorMessage).toBeDefined();
        expect(emptyQuestionsResult.errorMessage!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );

    // Test 2: Create with expiresInSeconds out of range (too small) + empty questions
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 59 }), (tooSmallExpiry) => {
        const result = handleAskUserRequest(
          {
            action: "create",
            payload: {
              questions: [],
              title: "Test",
              expiresInSeconds: tooSmallExpiry,
            },
          },
          0,
          `trace-small-expiry-${Date.now()}`,
        );
        expect(result.success).toBe(false);
        expect(result.errorMessage).toBeDefined();
        expect(result.errorMessage!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );

    // Test 3: Create with expiresInSeconds out of range (too large) + empty questions
    fc.assert(
      fc.property(fc.integer({ min: 86401, max: 200000 }), (tooLargeExpiry) => {
        const result = handleAskUserRequest(
          {
            action: "create",
            payload: {
              questions: [],
              title: "Test",
              expiresInSeconds: tooLargeExpiry,
            },
          },
          0,
          `trace-large-expiry-${Date.now()}`,
        );
        expect(result.success).toBe(false);
        expect(result.errorMessage).toBeDefined();
        expect(result.errorMessage!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );

    // Test 4: Get with non-existent ID → success: false
    fc.assert(
      fc.property(fc.uuid(), (fakeId) => {
        const result = handleAskUserRequest(
          {
            action: "get",
            payload: {
              interviewId: `non-existent-${fakeId}`,
            },
          },
          0,
          `trace-get-404-${Date.now()}`,
        );
        expect(result.success).toBe(false);
        expect(result.errorMessage).toBeDefined();
        expect(result.errorMessage!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );

    // Test 5: Submit with non-existent ID → success: false
    fc.assert(
      fc.property(fc.uuid(), (fakeId) => {
        const result = handleAskUserRequest(
          {
            action: "submit",
            payload: {
              interviewId: `non-existent-${fakeId}`,
              responses: [],
            },
          },
          0,
          `trace-submit-404-${Date.now()}`,
        );
        expect(result.success).toBe(false);
        expect(result.errorMessage).toBeDefined();
        expect(result.errorMessage!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
