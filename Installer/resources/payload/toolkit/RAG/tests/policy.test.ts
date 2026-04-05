import {
  validateDeleteInput,
  validateIngestInput,
  validateListInput,
  validateQueryInput,
  validateReindexInput,
} from "../src/policy";
import type { IngestDocumentsInput } from "../src/types";

describe("RAG policy", () => {
  test("accepts valid ingest input", () => {
    const error = validateIngestInput({
      documents: [{ text: "hello world" }],
    });

    expect(error).toBeUndefined();
  });

  test("rejects ingest without any source value", () => {
    const error = validateIngestInput({
      documents: [{ title: "No content" }],
    } as unknown as IngestDocumentsInput);

    expect(error).toContain("must provide one of text, filePath, or url");
  });

  test("accepts valid query input", () => {
    const error = validateQueryInput({ query: "what is the architecture" });
    expect(error).toBeUndefined();
  });

  test("rejects empty query input", () => {
    const error = validateQueryInput({ query: "" });
    expect(error).toContain("'query' is required");
  });

  test("validates list source bounds", () => {
    expect(validateListInput({ limit: 10, offset: 0 })).toBeUndefined();
    expect(validateListInput({ limit: 500 })).toContain("'limit' must be between");
    expect(validateListInput({ offset: -1 })).toContain("'offset' must be >= 0");
  });

  test("requires source id for delete and reindex", () => {
    expect(validateDeleteInput({ sourceId: "abc" })).toBeUndefined();
    expect(validateDeleteInput({ sourceId: "" })).toContain("'sourceId' is required");

    expect(validateReindexInput({ sourceId: "abc" })).toBeUndefined();
    expect(validateReindexInput({ sourceId: "" })).toContain("'sourceId' is required");
  });
});
