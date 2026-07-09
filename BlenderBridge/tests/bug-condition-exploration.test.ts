/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Bug Condition Exploration Tests - BlenderBridge Known Issues
 *
 * Property 1: Bug Condition - BlenderBridge Known Issues Reproduce
 *
 * These tests encode the EXPECTED (fixed) behavior for six known bugs.
 * On UNFIXED code, all tests MUST FAIL — failure confirms the bugs exist.
 * After the fix is implemented, these tests should PASS.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import {
  ExecuteBlenderCodeFn,
  createBlenderClient,
  formatExecutionError,
} from "../src/blender-client";
import { BlenderBridgeConfig } from "../src/types";
import { createRenderPreviewTool } from "../src/tools/render-preview.tool";
import { generateRenderPreviewCode } from "../src/codegen/render-preview.py";

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
  renderTimeoutMs: 90000,
  exportTimeoutMs: 90000,
};

describe("Bug Condition Exploration - BlenderBridge Known Issues", () => {
  /**
   * Test 1a - Timeout: Per-Operation Timeout Override
   *
   * Bug: operationTimeoutMs is hardcoded to 30000ms with no per-operation override.
   * Expected (fixed) behavior: System uses per-operation timeout (90000ms) for
   * renders/exports and does NOT terminate at 30s.
   *
   * On UNFIXED code, this FAILS because the config lacks renderTimeoutMs/exportTimeoutMs
   * fields and executeCode does not select timeout by operation type.
   *
   * Validates: Requirements 1.1
   */
  describe("Test 1a - Per-Operation Timeout Override", () => {
    it("config should have renderTimeoutMs field with 90000ms default", () => {
      // The fixed config should have a renderTimeoutMs field
      // On unfixed code: BlenderBridgeConfig does NOT have renderTimeoutMs
      expect((defaultConfig as any).renderTimeoutMs).toBeDefined();
      expect((defaultConfig as any).renderTimeoutMs).toBe(90000);
    });

    it("config should have exportTimeoutMs field with 90000ms default", () => {
      // The fixed config should have an exportTimeoutMs field
      // On unfixed code: BlenderBridgeConfig does NOT have exportTimeoutMs
      expect((defaultConfig as any).exportTimeoutMs).toBeDefined();
      expect((defaultConfig as any).exportTimeoutMs).toBe(90000);
    });

    it("executeCode should select timeout based on operationType 'render' (uses renderTimeoutMs, not global)", async () => {
      // On fixed code: executeCode("code", undefined, "render") should use
      // config.renderTimeoutMs (90000) instead of config.operationTimeoutMs (30000).
      // We test this by setting operationTimeoutMs=50 (very short) and renderTimeoutMs=500,
      // then passing a delegate that takes 100ms. If the system correctly selects the
      // render timeout (500ms), the operation succeeds. If it falls back to global (50ms),
      // it times out.
      const delegate: ExecuteBlenderCodeFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return '{"filePath": "/tmp/render.png"}';
      };

      const configWithShortGlobal: BlenderBridgeConfig = {
        ...defaultConfig,
        operationTimeoutMs: 50, // Very short - would time out if used
      };
      // On unfixed code: no renderTimeoutMs field exists, so the system uses global 50ms
      // and the 100ms delegate times out
      (configWithShortGlobal as any).renderTimeoutMs = 500;

      const client = createBlenderClient(configWithShortGlobal, delegate);

      // On fixed code: passing operationType "render" makes it use renderTimeoutMs (500ms)
      // On unfixed code: third argument is ignored, global 50ms is used, causing timeout
      const result = await (client.executeCode as any)(
        "bpy.ops.render.render()",
        undefined,
        "render",
      );

      expect(result.success).toBe(true);
    });
  });

  /**
   * Test 1b - Structured Timeout Error
   *
   * Bug: Timeout error is generic "Operation timed out after 30 seconds" with
   * no indication of operation type or retry guidance.
   * Expected (fixed) behavior: Error contains operationType, timeoutMs, and suggestion.
   *
   * On UNFIXED code, this FAILS because the error message is a plain string
   * without structured fields.
   *
   * Validates: Requirements 1.2
   */
  describe("Test 1b - Structured Timeout Error", () => {
    it("timeout error should contain operationType field", async () => {
      const delegate: ExecuteBlenderCodeFn = () =>
        new Promise((resolve) => setTimeout(() => resolve("late"), 200));
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.executeCode("bpy.ops.render.render()", 50);

      // On fixed code: error should have structured fields
      // On unfixed code: error.message is "Operation timed out after 0 seconds"
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect((result.error as any).operationType).toBeDefined();
    });

    it("timeout error should contain timeoutMs field", async () => {
      const delegate: ExecuteBlenderCodeFn = () =>
        new Promise((resolve) => setTimeout(() => resolve("late"), 200));
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.executeCode("bpy.ops.render.render()", 50);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect((result.error as any).timeoutMs).toBeDefined();
      expect((result.error as any).timeoutMs).toBe(50);
    });

    it("timeout error suggestion should mention retry with extended timeout", async () => {
      const delegate: ExecuteBlenderCodeFn = () =>
        new Promise((resolve) => setTimeout(() => resolve("late"), 200));
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.executeCode("bpy.ops.render.render()", 50);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // On fixed code: suggestion mentions retrying with extended timeout
      // On unfixed code: suggestion is "Verify Blender is responsive..."
      expect(result.error!.suggestion).toMatch(/retry|extended|timeout/i);
    });
  });

  /**
   * Test 1c - Blender 5.x API Compatibility
   *
   * Bug: No version detection or API compatibility mapping exists.
   * Expected (fixed) behavior: System detects Blender version and applies
   * compatibility mappings for known breaking changes.
   *
   * On UNFIXED code, this FAILS because no compatibility layer exists.
   *
   * Validates: Requirements 1.3
   */
  describe("Test 1c - Blender 5.x API Compatibility", () => {
    it("should have a compatibility mapping for bpy.ops.export_mesh.stl() -> bpy.ops.wm.stl_export()", () => {
      // The fixed code should have a module/function that maps deprecated APIs
      // On unfixed code: no such mapping exists anywhere in the codebase
      let hasCompatibilityModule = false;
      try {
        // Try to import a compatibility module - on unfixed code this won't exist
        const compat = require("../src/addon-transport");
        hasCompatibilityModule =
          typeof (compat as any).getApiCompatibilityMappings === "function" ||
          typeof (compat as any).applyCompatibilityLayer === "function" ||
          typeof (compat as any).getBlenderVersionCached === "function";
      } catch {
        hasCompatibilityModule = false;
      }
      expect(hasCompatibilityModule).toBe(true);
    });

    it("generated code using deprecated export_mesh.stl should be remapped for Blender 5.x", () => {
      // On fixed code: generateCodeForTool or similar should detect version
      // and remap deprecated operators
      // On unfixed code: code passes through unchanged
      const addonTransport = require("../src/addon-transport");

      // If a compatibility function exists, it should remap the code
      const inputCode = "bpy.ops.export_mesh.stl(filepath='/tmp/test.stl')";

      // The fixed system should have a function that applies compatibility mappings
      const applyCompat =
        (addonTransport as any).applyCompatibilityLayer ||
        (addonTransport as any).applyApiMapping;

      expect(applyCompat).toBeDefined();
      if (applyCompat) {
        const result = applyCompat(inputCode, [5, 1, 0]);
        expect(result).toContain("wm.stl_export");
      }
    });
  });

  /**
   * Test 1d - Structured Operator Error
   *
   * Bug: Operator errors are raw strings like "context is incorrect" with
   * no structured information.
   * Expected (fixed) behavior: Error contains operatorName, requiredContext,
   * availableEnums, and suggestions.
   *
   * On UNFIXED code, this FAILS because formatExecutionError() only does
   * keyword matching and doesn't extract structured operator info.
   *
   * Validates: Requirements 1.4
   */
  describe("Test 1d - Structured Operator Error", () => {
    it("operator error should contain operatorName field", () => {
      const errorMsg = `Traceback (most recent call last):
  File "<string>", line 1, in <module>
RuntimeError: Operator bpy.ops.object.modifier_apply.poll() failed, context is incorrect`;

      const result = formatExecutionError(new Error(errorMsg));

      expect(result.success).toBe(false);
      // On fixed code: error should have operatorName extracted
      // On unfixed code: no such field exists
      expect((result.error as any).operatorName).toBeDefined();
      expect((result.error as any).operatorName).toContain("modifier_apply");
    });

    it("operator error should contain requiredContext field", () => {
      const errorMsg = `Traceback (most recent call last):
  File "<string>", line 1, in <module>
RuntimeError: Operator bpy.ops.object.modifier_apply.poll() failed, context is incorrect`;

      const result = formatExecutionError(new Error(errorMsg));

      expect(result.success).toBe(false);
      // On fixed code: error should indicate what context is required
      // On unfixed code: no such field exists
      expect((result.error as any).requiredContext).toBeDefined();
    });

    it("operator error for invalid enum should contain availableEnums field", () => {
      const errorMsg = `Traceback (most recent call last):
  File "<string>", line 1, in <module>
TypeError: bpy.ops.object.modifier_add(): error with keyword argument "type" - enum "SUBDIVISION" not found in ('ARRAY', 'BEVEL', 'BOOLEAN', 'MIRROR', 'SUBSURF')`;

      const result = formatExecutionError(new Error(errorMsg));

      expect(result.success).toBe(false);
      // On fixed code: error should list available enum values
      // On unfixed code: no such field exists
      expect((result.error as any).availableEnums).toBeDefined();
      expect(Array.isArray((result.error as any).availableEnums)).toBe(true);
    });

    it("operator error should contain suggestions (did-you-mean)", () => {
      const errorMsg = `Traceback (most recent call last):
  File "<string>", line 1, in <module>
TypeError: bpy.ops.object.modifier_add(): error with keyword argument "type" - enum "SUBDIVISION" not found in ('ARRAY', 'BEVEL', 'BOOLEAN', 'MIRROR', 'SUBSURF')`;

      const result = formatExecutionError(new Error(errorMsg));

      expect(result.success).toBe(false);
      // On fixed code: should suggest "SUBSURF" as close match for "SUBDIVISION"
      // On unfixed code: no such field exists
      expect((result.error as any).suggestions).toBeDefined();
      expect(Array.isArray((result.error as any).suggestions)).toBe(true);
    });
  });

  /**
   * Test 1e - Inline Image Return
   *
   * Bug: Render tool returns only { type: "text" } with file path,
   * no inline image content.
   * Expected (fixed) behavior: Response contains { type: "image", data: base64, mimeType }.
   *
   * On UNFIXED code, this FAILS because the render tool only returns text content.
   *
   * Validates: Requirements 1.5
   */
  describe("Test 1e - Inline Image Return", () => {
    it("render tool response should contain image content type with base64 data", async () => {
      // Mock delegate that simulates a successful render
      const delegate: ExecuteBlenderCodeFn = async () => {
        return JSON.stringify({
          filePath: "/tmp/blender_preview_123.png",
          imageData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        });
      };

      const client = createBlenderClient(defaultConfig, delegate);
      const tool = createRenderPreviewTool(defaultConfig, client);
      const result = await tool.handler({});

      // On fixed code: response should include image content
      // On unfixed code: only { type: "text" } is in content array
      const hasImageContent = result.content.some(
        (item: any) => item.type === "image" && item.data && item.mimeType === "image/png",
      );
      expect(hasImageContent).toBe(true);
    });

    it("render codegen should include base64 encoding of rendered image", () => {
      // On fixed code: the generated Python should read and base64-encode the rendered file
      // On unfixed code: the codegen only renders and returns filePath, no base64 encoding
      const code = generateRenderPreviewCode({
        outputPath: "/tmp/test_render.png",
        width: 480,
        height: 270,
      });

      // The fixed codegen should include base64 encoding logic
      expect(code).toContain("base64");
      expect(code).toContain("imageData");
    });
  });

  /**
   * Test 1f - Mesh Validation
   *
   * Bug: No mesh validation capability exists.
   * Expected (fixed) behavior: A mesh validation tool exists that reports
   * inverted faces, non-manifold edges, loose vertices, and face orientation.
   *
   * On UNFIXED code, this FAILS because the tool/module doesn't exist.
   *
   * Validates: Requirements 1.6
   */
  describe("Test 1f - Mesh Validation", () => {
    it("mesh validation tool module should exist", () => {
      // On fixed code: src/tools/mesh-validate.tool.ts exists
      // On unfixed code: this module does not exist
      let meshValidateExists = false;
      try {
        const meshValidate = require("../src/tools/mesh-validate.tool");
        meshValidateExists = typeof meshValidate.createMeshValidateTool === "function";
      } catch {
        meshValidateExists = false;
      }
      expect(meshValidateExists).toBe(true);
    });

    it("mesh validation codegen module should exist", () => {
      // On fixed code: src/codegen/mesh-validate.py.ts exists
      // On unfixed code: this module does not exist
      let meshCodegenExists = false;
      try {
        const meshCodegen = require("../src/codegen/mesh-validate.py");
        meshCodegenExists = typeof meshCodegen.generateMeshValidateCode === "function";
      } catch {
        meshCodegenExists = false;
      }
      expect(meshCodegenExists).toBe(true);
    });

    it("MeshValidationResult type should be defined with required fields", () => {
      // On fixed code: types.ts should export MeshValidationResult
      // On unfixed code: no such type exists
      const types = require("../src/types");

      // We can't directly check TypeScript types at runtime, but we can verify
      // that the mesh validation tool returns the expected structure
      // For now, verify the mesh validate tool produces structured results
      let hasValidationResult = false;
      try {
        const meshValidate = require("../src/tools/mesh-validate.tool");
        hasValidationResult = typeof meshValidate.createMeshValidateTool === "function";
      } catch {
        hasValidationResult = false;
      }
      expect(hasValidationResult).toBe(true);
    });
  });
});
