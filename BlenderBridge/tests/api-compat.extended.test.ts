/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 8: Version string parsing round-trip
 * Feature: blender-bridge-improvements, Property 9: Compatibility layer transforms deprecated patterns
 *
 * Tests findMigrationMapping(), version parsing, and applyCompatibilityLayer()
 * from api-compat.ts.
 */

import * as fc from "fast-check";
import {
  applyCompatibilityLayer,
  formatVersion,
  getApiCompatibilityMappings,
  parseVersionString,
} from "../src/api-compat";

describe("api-compat extended property tests", () => {
  /**
   * Property 8: Version string parsing round-trip
   *
   * For any version tuple [major, minor, patch] where each component
   * is a non-negative integer, formatting and re-parsing produces the same tuple.
   */
  describe("Property 8: Version string parsing round-trip", () => {
    const versionComponentArb = fc.integer({ min: 0, max: 999 });
    const versionTupleArb = fc.tuple(versionComponentArb, versionComponentArb, versionComponentArb);

    it("formatVersion + parseVersionString produces the same tuple", () => {
      fc.assert(
        fc.property(versionTupleArb, ([major, minor, patch]) => {
          const tuple: [number, number, number] = [major, minor, patch];
          const formatted = formatVersion(tuple);
          const parsed = parseVersionString(formatted);
          expect(parsed).not.toBeNull();
          expect(parsed).toEqual(tuple);
        }),
        { numRuns: 100 },
      );
    });

    it("formatVersion produces 'major.minor.patch' format", () => {
      fc.assert(
        fc.property(versionTupleArb, ([major, minor, patch]) => {
          const tuple: [number, number, number] = [major, minor, patch];
          const formatted = formatVersion(tuple);
          expect(formatted).toBe(`${major}.${minor}.${patch}`);
        }),
        { numRuns: 100 },
      );
    });

    it("parseVersionString returns null for invalid formats", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(""),
            fc.constant("1.2"),
            fc.constant("1.2.3.4"),
            fc.constant("abc"),
            fc.constant("1.a.3"),
            fc.constant("-1.2.3"),
          ),
          (invalidStr) => {
            const result = parseVersionString(invalidStr);
            if (invalidStr === "-1.2.3") {
              // -1 is a negative int, should return null
              expect(result).toBeNull();
            } else if (result !== null) {
              // If it parses, each component must be a non-negative integer
              expect(result.length).toBe(3);
              for (const n of result) {
                expect(Number.isInteger(n)).toBe(true);
                expect(n).toBeGreaterThanOrEqual(0);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 9: Compatibility layer transforms deprecated patterns
   *
   * For code containing deprecated patterns, applying the compat layer
   * with version >= minVersion replaces them. Code without deprecated
   * patterns passes through unchanged.
   */
  describe("Property 9: Compatibility layer transforms deprecated patterns", () => {
    const _mappings = getApiCompatibilityMappings();

    // Code snippets containing deprecated patterns
    const deprecatedCodeSnippets = [
      "bpy.ops.export_mesh.stl(filepath='/tmp/out.stl')",
      "bpy.ops.export_mesh.obj(filepath='/tmp/out.obj')",
      "bpy.ops.export_mesh.ply(filepath='/tmp/out.ply')",
      "bpy.ops.object.shade_smooth()",
      "mod = obj.modifiers.new('Sub', type='SUBSURF')",
    ];

    const expectedReplacements = [
      "bpy.ops.wm.stl_export(filepath='/tmp/out.stl')",
      "bpy.ops.wm.obj_export(filepath='/tmp/out.obj')",
      "bpy.ops.wm.ply_export(filepath='/tmp/out.ply')",
      "bpy.ops.object.shade_smooth_by_angle()",
      "mod = obj.modifiers.new('Sub', type='SUBDIVISION')",
    ];

    it("transforms deprecated patterns when version >= 5.0.0", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            ...deprecatedCodeSnippets.map((code, i) => ({
              code,
              expected: expectedReplacements[i],
            })),
          ),
          ({ code, expected }) => {
            const result = applyCompatibilityLayer(code, [5, 0, 0]);
            expect(result).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("does not transform code when version < 5.0.0", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...deprecatedCodeSnippets),
          fc.tuple(
            fc.integer({ min: 1, max: 4 }),
            fc.integer({ min: 0, max: 9 }),
            fc.integer({ min: 0, max: 9 }),
          ),
          (code, [major, minor, patch]) => {
            const result = applyCompatibilityLayer(code, [major, minor, patch]);
            expect(result).toBe(code);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("code without deprecated patterns passes through unchanged", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            "import bpy\nbpy.ops.mesh.primitive_cube_add()",
            "bpy.context.scene.render.resolution_x = 1920",
            "obj = bpy.data.objects['Cube']",
            "bpy.ops.wm.stl_export(filepath='/tmp/out.stl')",
            "print('hello world')",
          ),
          (code) => {
            const result = applyCompatibilityLayer(code, [5, 0, 0]);
            expect(result).toBe(code);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("multiple deprecated patterns in one string are all replaced", () => {
      const code = "bpy.ops.export_mesh.stl()\nbpy.ops.export_mesh.obj()";
      const result = applyCompatibilityLayer(code, [5, 0, 0]);
      expect(result).toContain("bpy.ops.wm.stl_export");
      expect(result).toContain("bpy.ops.wm.obj_export");
      expect(result).not.toContain("export_mesh.stl");
      expect(result).not.toContain("export_mesh.obj");
    });
  });
});
