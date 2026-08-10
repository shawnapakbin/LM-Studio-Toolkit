import { validateEndpoints } from "../../src/validation";

describe("validateEndpoints", () => {
  const validEntry = {
    id: "ep-1",
    host: "192.168.1.10",
    port: 1234,
    models: ["qwen2.5-coder-32b"],
    maxConcurrency: 4,
    enabled: true,
    source: "manual" as const,
  };

  it("accepts a valid endpoint entry", () => {
    const result = validateEndpoints([validEntry]);
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.valid[0]).toEqual(validEntry);
  });

  it("rejects entry with empty host", () => {
    const result = validateEndpoints([{ ...validEntry, host: "" }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe("ep-1");
    expect(result.errors[0].reasons).toContain("host must be a non-empty string");
  });

  it("rejects entry with whitespace-only host", () => {
    const result = validateEndpoints([{ ...validEntry, host: "   " }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0].reasons).toContain("host must be a non-empty string");
  });

  it("rejects entry with port 0", () => {
    const result = validateEndpoints([{ ...validEntry, port: 0 }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0].reasons).toContain("port must be an integer between 1 and 65535");
  });

  it("rejects entry with port above 65535", () => {
    const result = validateEndpoints([{ ...validEntry, port: 70000 }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0].reasons).toContain("port must be an integer between 1 and 65535");
  });

  it("rejects entry with non-integer port", () => {
    const result = validateEndpoints([{ ...validEntry, port: 1234.5 }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0].reasons).toContain("port must be an integer between 1 and 65535");
  });

  it("rejects entry with models array exceeding 50", () => {
    const models = Array.from({ length: 51 }, (_, i) => `model-${i}`);
    const result = validateEndpoints([{ ...validEntry, models }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0].reasons).toContain("models array must have at most 50 entries");
  });

  it("accepts entry with exactly 50 models", () => {
    const models = Array.from({ length: 50 }, (_, i) => `model-${i}`);
    const result = validateEndpoints([{ ...validEntry, models }]);
    expect(result.valid).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects entry with maxConcurrency 0", () => {
    const result = validateEndpoints([{ ...validEntry, maxConcurrency: 0 }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0].reasons).toContain(
      "maxConcurrency must be an integer between 1 and 100",
    );
  });

  it("rejects entry with maxConcurrency above 100", () => {
    const result = validateEndpoints([{ ...validEntry, maxConcurrency: 101 }]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors[0].reasons).toContain(
      "maxConcurrency must be an integer between 1 and 100",
    );
  });

  it("accepts entry with maxConcurrency at boundaries (1 and 100)", () => {
    const r1 = validateEndpoints([{ ...validEntry, maxConcurrency: 1 }]);
    expect(r1.valid).toHaveLength(1);

    const r100 = validateEndpoints([{ ...validEntry, maxConcurrency: 100 }]);
    expect(r100.valid).toHaveLength(1);
  });

  it("accepts entry with port at boundaries (1 and 65535)", () => {
    const r1 = validateEndpoints([{ ...validEntry, port: 1 }]);
    expect(r1.valid).toHaveLength(1);

    const r65535 = validateEndpoints([{ ...validEntry, port: 65535 }]);
    expect(r65535.valid).toHaveLength(1);
  });

  it("collects multiple validation reasons for one entry", () => {
    const result = validateEndpoints([{ ...validEntry, host: "", port: -1 }]);
    expect(result.errors[0].reasons).toHaveLength(2);
    expect(result.errors[0].reasons).toContain("host must be a non-empty string");
    expect(result.errors[0].reasons).toContain("port must be an integer between 1 and 65535");
  });

  it("filters valid and invalid entries in a mixed array", () => {
    const entries = [
      validEntry,
      { ...validEntry, id: "bad-host", host: "" },
      { ...validEntry, id: "ep-2", host: "10.0.0.5", port: 5000 },
    ];
    const result = validateEndpoints(entries);
    expect(result.valid).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe("bad-host");
  });

  it("never throws on malformed input", () => {
    expect(() => validateEndpoints([null, undefined, 42, "string", {}])).not.toThrow();
  });

  it("handles non-object entries gracefully", () => {
    const result = validateEndpoints([null, 42, "hello"]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(3);
  });

  it("handles entry without id (id is undefined in error)", () => {
    const entry = { host: "", port: 1234, models: [], maxConcurrency: 4 };
    const result = validateEndpoints([entry]);
    expect(result.errors[0].id).toBeUndefined();
  });

  it("returns empty results for empty input array", () => {
    const result = validateEndpoints([]);
    expect(result.valid).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
