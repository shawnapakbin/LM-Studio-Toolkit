/**
 * Unit tests for passthrough-helpers validation utilities.
 * Validates: Requirements 10.1, 10.2, 10.4, 10.5
 */

import {
  connectionError,
  formatPassthroughResult,
  timeoutError,
  upstreamError,
  validateEnum,
  validateNonWhitespaceParam,
  validateNumericRange,
  validateStringParam,
  validationError,
} from "../src/tools/passthrough/passthrough-helpers";
import { CallToolResult, OrchestrationErrorResponse } from "../src/types";

describe("validateStringParam", () => {
  it("returns null for a valid string within max length", () => {
    expect(validateStringParam("hello", "name", 256)).toBeNull();
  });

  it("returns null for a string exactly at max length", () => {
    const str = "a".repeat(100);
    expect(validateStringParam(str, "code", 100)).toBeNull();
  });

  it("returns error for empty string", () => {
    const result = validateStringParam("", "name", 256);
    expect(result).not.toBeNull();
    expect(result).toContain("name");
    expect(result).toContain("non-empty");
  });

  it("returns error for string exceeding max length", () => {
    const str = "a".repeat(257);
    const result = validateStringParam(str, "identifier", 256);
    expect(result).not.toBeNull();
    expect(result).toContain("identifier");
    expect(result).toContain("256");
    expect(result).toContain("257");
  });

  it("returns error for non-string values", () => {
    expect(validateStringParam(undefined, "x", 10)).not.toBeNull();
    expect(validateStringParam(null, "x", 10)).not.toBeNull();
    expect(validateStringParam(123, "x", 10)).not.toBeNull();
  });
});

describe("validateNonWhitespaceParam", () => {
  it("returns null for a valid non-whitespace string", () => {
    expect(validateNonWhitespaceParam("hello", "path")).toBeNull();
  });

  it("returns null for string with leading/trailing whitespace but content", () => {
    expect(validateNonWhitespaceParam("  hello  ", "path")).toBeNull();
  });

  it("returns error for whitespace-only string", () => {
    const result = validateNonWhitespaceParam("   ", "output_path");
    expect(result).not.toBeNull();
    expect(result).toContain("output_path");
    expect(result).toContain("whitespace");
  });

  it("returns error for empty string", () => {
    const result = validateNonWhitespaceParam("", "output_path");
    expect(result).not.toBeNull();
    expect(result).toContain("output_path");
  });

  it("returns error for non-string values", () => {
    expect(validateNonWhitespaceParam(undefined, "p")).not.toBeNull();
    expect(validateNonWhitespaceParam(null, "p")).not.toBeNull();
    expect(validateNonWhitespaceParam(42, "p")).not.toBeNull();
  });
});

describe("validateNumericRange", () => {
  it("returns null for a valid integer within range", () => {
    expect(validateNumericRange(5, "max_results", 1, 100)).toBeNull();
  });

  it("returns null for value at min boundary", () => {
    expect(validateNumericRange(1, "max_results", 1, 100)).toBeNull();
  });

  it("returns null for value at max boundary", () => {
    expect(validateNumericRange(100, "max_results", 1, 100)).toBeNull();
  });

  it("returns error for value below range", () => {
    const result = validateNumericRange(0, "max_results", 1, 100);
    expect(result).not.toBeNull();
    expect(result).toContain("max_results");
    expect(result).toContain("1");
    expect(result).toContain("100");
  });

  it("returns error for value above range", () => {
    const result = validateNumericRange(101, "max_results", 1, 100);
    expect(result).not.toBeNull();
    expect(result).toContain("max_results");
    expect(result).toContain("101");
  });

  it("returns error for non-integer number", () => {
    const result = validateNumericRange(3.5, "context", 0, 10);
    expect(result).not.toBeNull();
    expect(result).toContain("context");
    expect(result).toContain("integer");
  });

  it("returns error for non-number types", () => {
    expect(validateNumericRange("5", "x", 0, 10)).not.toBeNull();
    expect(validateNumericRange(undefined, "x", 0, 10)).not.toBeNull();
    expect(validateNumericRange(null, "x", 0, 10)).not.toBeNull();
  });
});

describe("validateEnum", () => {
  const allowedTypes = ["VIEW_3D", "IMAGE_EDITOR", "UV", "OUTLINER"] as const;

  it("returns null for a valid enum value", () => {
    expect(validateEnum("VIEW_3D", "area_ui_type", allowedTypes)).toBeNull();
  });

  it("returns null for last value in allowed list", () => {
    expect(validateEnum("OUTLINER", "area_ui_type", allowedTypes)).toBeNull();
  });

  it("returns error for invalid enum value", () => {
    const result = validateEnum("INVALID", "area_ui_type", allowedTypes);
    expect(result).not.toBeNull();
    expect(result).toContain("area_ui_type");
    expect(result).toContain("VIEW_3D");
    expect(result).toContain("OUTLINER");
  });

  it("returns error for non-string types", () => {
    expect(validateEnum(123, "area_ui_type", allowedTypes)).not.toBeNull();
    expect(validateEnum(undefined, "area_ui_type", allowedTypes)).not.toBeNull();
    expect(validateEnum(null, "area_ui_type", allowedTypes)).not.toBeNull();
  });

  it("is case-sensitive", () => {
    const result = validateEnum("view_3d", "area_ui_type", allowedTypes);
    expect(result).not.toBeNull();
  });
});

describe("formatPassthroughResult", () => {
  it("passes through text content on success", () => {
    const input: CallToolResult = {
      isError: false,
      content: [{ type: "text", text: '{"objects": []}' }],
    };
    const result = formatPassthroughResult(input);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: '{"objects": []}' }]);
  });

  it("handles multiple text content items on success", () => {
    const input: CallToolResult = {
      isError: false,
      content: [
        { type: "text", text: "line1" },
        { type: "text", text: "line2" },
      ],
    };
    const result = formatPassthroughResult(input);
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toBe("line1");
    expect(result.content[1].text).toBe("line2");
  });

  it("includes image count reference for image content on success", () => {
    const input: CallToolResult = {
      isError: false,
      content: [{ type: "image", data: "base64data", mimeType: "image/png" }],
    };
    const result = formatPassthroughResult(input);
    expect(result.isError).toBe(false);
    expect(result.content.some((c) => c.text.includes("1 image(s)"))).toBe(true);
  });

  it("wraps error responses as OrchestrationErrorResponse", () => {
    const input: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "Object not found: Cube" }],
    };
    const result = formatPassthroughResult(input);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("UPSTREAM_ERROR");
    expect(parsed.error.message).toContain("Object not found: Cube");
  });

  it("returns empty text content when success has no content", () => {
    const input: CallToolResult = {
      isError: false,
      content: [],
    };
    const result = formatPassthroughResult(input);
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("");
  });
});

describe("error formatting - timeoutError", () => {
  it("produces valid OrchestrationErrorResponse JSON with BLENDER_TIMEOUT code", () => {
    const result = timeoutError(30000);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("BLENDER_TIMEOUT");
    expect(parsed.error.message).toContain("timed out");
    expect(parsed.error.message).toContain("30");
    expect(parsed.error.suggestion).toContain("blender_health_check");
  });
});

describe("error formatting - upstreamError", () => {
  it("produces valid OrchestrationErrorResponse JSON with UPSTREAM_ERROR code", () => {
    const result = upstreamError("Object not found");
    expect(result.isError).toBe(true);

    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("UPSTREAM_ERROR");
    expect(parsed.error.message).toBe("Object not found");
  });

  it("includes traceback when provided", () => {
    const result = upstreamError("Error", "Traceback line 1\nline 2");
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.error.traceback).toBe("Traceback line 1\nline 2");
  });

  it("includes suggestion when provided", () => {
    const result = upstreamError("Error", undefined, "Try again");
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.error.suggestion).toBe("Try again");
  });

  it("omits optional fields when not provided", () => {
    const result = upstreamError("Error");
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.error.traceback).toBeUndefined();
    expect(parsed.error.suggestion).toBeUndefined();
  });
});

describe("error formatting - connectionError", () => {
  it("produces valid OrchestrationErrorResponse JSON with CONNECTION_ERROR code", () => {
    const result = connectionError("Connection refused");
    expect(result.isError).toBe(true);

    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("CONNECTION_ERROR");
    expect(parsed.error.message).toBe("Connection refused");
    expect(parsed.error.suggestion).toContain("blender_health_check");
  });
});

describe("error formatting - validationError", () => {
  it("returns isError true with the message as plain text content", () => {
    const result = validationError("name must be a non-empty string.");
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("name must be a non-empty string.");
  });

  it("does not wrap message in JSON", () => {
    const result = validationError("Invalid param");
    // Should be plain text, not parseable as OrchestrationErrorResponse
    expect(() => {
      const parsed = JSON.parse(result.content[0].text);
      // If it parses, it shouldn't have the OrchestrationErrorResponse shape
      expect(parsed.success).toBeUndefined();
    }).toThrow(); // plain text will throw on JSON.parse
  });
});
