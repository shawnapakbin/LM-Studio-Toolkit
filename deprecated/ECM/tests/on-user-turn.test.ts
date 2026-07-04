/**
 * ECM core — on_user_turn behaviour.
 */
import { clearSession, getStatus, onUserTurn, resetEcmState, storeSegment } from "../src/ecm";
import type {
  ClearSessionResult,
  GetStatusResult,
  OnUserTurnResult,
  SegmentRecord,
} from "../src/types";

const SESSION = "core-test";

afterEach(() => {
  resetEcmState();
});

async function seed(
  content: string,
  type: SegmentRecord["type"] = "conversation_turn",
): Promise<void> {
  const res = await storeSegment({ sessionId: SESSION, type, content });
  if (!res.success) throw new Error(res.errorMessage);
}

describe("on_user_turn", () => {
  test("no-op when ratio is below threshold", async () => {
    await seed("alpha");
    const res = await onUserTurn({
      sessionId: SESSION,
      currentUsedTokens: 100,
      contextLimit: 32000,
      threshold: 0.5,
    });
    expect(res.success).toBe(true);
    const data = res.data as OnUserTurnResult;
    expect(data.compacted).toBe(false);
    expect(data.reason).toBe("below_threshold");
    expect(data.message).toMatch(/below/);
  });

  test("no-op when not enough older segments", async () => {
    await seed("only one");
    const res = await onUserTurn({
      sessionId: SESSION,
      currentUsedTokens: 9000,
      contextLimit: 16000,
      keepNewest: 4,
    });
    const data = res.data as OnUserTurnResult;
    expect(data.compacted).toBe(false);
    expect(data.reason).toBe("not_enough_segments");
  });

  test("compacts older segments when over threshold", async () => {
    for (let i = 0; i < 8; i++) {
      await seed(`segment number ${i} with some content `.repeat(5));
    }

    const before = await getStatus({ sessionId: SESSION });
    const beforeData = before.data as GetStatusResult;
    expect(beforeData.segmentCount).toBe(8);

    const res = await onUserTurn({
      sessionId: SESSION,
      currentUsedTokens: 9000,
      contextLimit: 16000,
      keepNewest: 2,
      threshold: 0.5,
    });
    expect(res.success).toBe(true);
    const data = res.data as OnUserTurnResult;
    expect(data.compacted).toBe(true);
    expect(data.reason).toBe("compacted");
    expect(data.segmentsRemoved).toBe(6);
    expect(data.summarySegmentId).toBeTruthy();
    expect(data.summaryTokenCount).toBeGreaterThan(0);

    const after = await getStatus({ sessionId: SESSION });
    const afterData = after.data as GetStatusResult;
    // 2 newest preserved + 1 summary
    expect(afterData.segmentCount).toBe(3);
    expect(afterData.nonSummarySegmentCount).toBe(2);
  });

  test("falls back to internal token count when currentUsedTokens omitted", async () => {
    // 6 segments × 12 000 chars ≈ 6 × 3 000 tokens = 18 000 tokens
    // ratio = 18 000 / 32 000 ≈ 0.56, above the 0.5 threshold
    for (let i = 0; i < 6; i++) await seed("x".repeat(12000));
    const res = await onUserTurn({
      sessionId: SESSION,
      contextLimit: 32000,
      threshold: 0.5,
      keepNewest: 1,
    });
    const data = res.data as OnUserTurnResult;
    expect(data.compacted).toBe(true);
  });

  test("rejects invalid threshold", async () => {
    const res = await onUserTurn({ sessionId: SESSION, threshold: 0 });
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("INVALID_INPUT");
  });
});

describe("clear_session", () => {
  test("removes all segments", async () => {
    await seed("a");
    await seed("b");
    const res = await clearSession({ sessionId: SESSION });
    const data = res.data as ClearSessionResult;
    expect(data.deletedCount).toBe(2);
  });
});

describe("get_status", () => {
  test("reports zero for unknown session", async () => {
    const res = await getStatus({ sessionId: "never-used" });
    const data = res.data as GetStatusResult;
    expect(data.segmentCount).toBe(0);
    expect(data.estimatedUsedTokens).toBe(0);
  });
});
