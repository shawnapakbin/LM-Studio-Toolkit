/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Unit tests for API compatibility basics.
 *
 * Tests fundamental behavior of the api-compat module:
 * version parsing, formatting, mapping lookup, and compatibility layer.
 */

import {
  applyCompatibilityLayer,
  findMigrationMapping,
  formatVersion,
  getApiCompatibilityMappings,
  parseVersionString,
} from "../src/api-compat";

describe("api-compat unit tests", () => {
  describe("formatVersion", () => {
    it("formats [5, 1, 0] as '5.1.0'", () => {
      expect(formatVersion([5, 1, 0])).toBe("5.1.0");
    });

    it("formats [0, 0, 0] as '0.0.0'", () => {
      expect(formatVersion([0, 0, 0])).toBe("0.0.0");
    });

    it("formats [10, 20, 30] as '10.20.30'", () => {
      expect(formatVersion([10, 20, 30])).toBe("10.20.30");
    });
  });

  describe("parseVersionString", () => {
    it("parses '5.1.0' to [5, 1, 0]", () => {
      expect(parseVersionString("5.1.0")).toEqual([5, 1, 0]);
    });

    it("parses '0.0.0' to [0, 0, 0]", () => {
      expect(parseVersionString("0.0.0")).toEqual([0, 0, 0]);
    });

    it("returns null for '1.2'", () => {
      expect(parseVersionString("1.2")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseVersionString("")).toBeNull();
    });

    it("returns null for '1.2.3.4'", () => {
      expect(parseVersionString("1.2.3.4")).toBeNull();
    });

    it("returns null for non-numeric components", () => {
      expect(parseVersionString("a.b.c")).toBeNull();
    });

    it("returns null for negative components", () => {
      expect(parseVersionString("-1.2.3")).toBeNull();
    });
  });

  describe("getApiCompatibilityMappings", () => {
    it("returns a non-empty array", () => {
      const mappings = getApiCompatibilityMappings();
      expect(Array.isArray(mappings)).toBe(true);
      expect(mappings.length).toBeGreaterThan(0);
    });

    it("each mapping has required fields", () => {
      const mappings = getApiCompatibilityMappings();
      for (const mapping of mappings) {
        expect(mapping.pattern).toBeInstanceOf(RegExp);
        expect(typeof mapping.replacement).toBe("string");
        expect(typeof mapping.description).toBe("string");
        expect(Array.isArray(mapping.minVersion)).toBe(true);
        expect(mapping.minVersion.length).toBe(3);
      }
    });
  });

  describe("findMigrationMapping", () => {
    it("finds mapping for bpy.ops.export_mesh.stl at version 5.0.0", () => {
      const result = findMigrationMapping("Error: bpy.ops.export_mesh.stl not found", [5, 0, 0]);
      expect(result).not.toBeNull();
      expect(result!.replacementApi).toBe("bpy.ops.wm.stl_export");
    });

    it("finds mapping for bpy.ops.export_mesh.obj at version 5.0.0", () => {
      const result = findMigrationMapping(
        "Error: bpy.ops.export_mesh.obj is deprecated",
        [5, 0, 0],
      );
      expect(result).not.toBeNull();
      expect(result!.replacementApi).toBe("bpy.ops.wm.obj_export");
    });

    it("returns null when version is below minVersion", () => {
      const result = findMigrationMapping("Error: bpy.ops.export_mesh.stl not found", [4, 0, 0]);
      expect(result).toBeNull();
    });

    it("returns null for unrelated error messages", () => {
      const result = findMigrationMapping("TypeError: expected int, got str", [5, 0, 0]);
      expect(result).toBeNull();
    });

    it("includes introducedInVersion in the result", () => {
      const result = findMigrationMapping("bpy.ops.export_mesh.ply failed", [5, 0, 0]);
      expect(result).not.toBeNull();
      expect(result!.introducedInVersion).toBe("5.0.0");
    });
  });

  describe("applyCompatibilityLayer", () => {
    it("replaces export_mesh.stl with wm.stl_export for version 5.0.0", () => {
      const code = "bpy.ops.export_mesh.stl(filepath='/tmp/out.stl')";
      const result = applyCompatibilityLayer(code, [5, 0, 0]);
      expect(result).toBe("bpy.ops.wm.stl_export(filepath='/tmp/out.stl')");
    });

    it("replaces SUBSURF with SUBDIVISION for version 5.0.0", () => {
      const code = "obj.modifiers.new('Sub', type='SUBSURF')";
      const result = applyCompatibilityLayer(code, [5, 0, 0]);
      expect(result).toContain("type='SUBDIVISION'");
    });

    it("does not modify code for version 4.x", () => {
      const code = "bpy.ops.export_mesh.stl(filepath='/tmp/out.stl')";
      const result = applyCompatibilityLayer(code, [4, 2, 0]);
      expect(result).toBe(code);
    });

    it("passes through code without deprecated patterns unchanged", () => {
      const code = "import bpy\nprint(bpy.app.version_string)";
      const result = applyCompatibilityLayer(code, [5, 0, 0]);
      expect(result).toBe(code);
    });
  });
});
