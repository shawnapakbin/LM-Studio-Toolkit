/**
 * Feature: blender-mcp-integration, Property 4: Create object codegen produces syntactically structured Python
 *
 * Validates: Requirements 4.1
 */

import * as fc from "fast-check";
import { generateCreateObjectCode } from "../src/codegen/create-object.py";
import { CreateObjectParams } from "../src/types";

/** The 9 allowed geometry types. */
const ALLOWED_GEOMETRY_TYPES: CreateObjectParams["geometryType"][] = [
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
  "circle",
  "curve",
  "empty",
];

/** Expected bpy.ops call for each geometry type. */
const GEOMETRY_OPS_MAP: Record<CreateObjectParams["geometryType"], string> = {
  cube: "bpy.ops.mesh.primitive_cube_add",
  sphere: "bpy.ops.mesh.primitive_uv_sphere_add",
  cylinder: "bpy.ops.mesh.primitive_cylinder_add",
  cone: "bpy.ops.mesh.primitive_cone_add",
  torus: "bpy.ops.mesh.primitive_torus_add",
  plane: "bpy.ops.mesh.primitive_plane_add",
  circle: "bpy.ops.mesh.primitive_circle_add",
  curve: "bpy.ops.curve.primitive_bezier_curve_add",
  empty: "bpy.ops.object.empty_add",
};

describe("codegen property tests", () => {
  /**
   * Feature: blender-mcp-integration, Property 4: Create object codegen produces syntactically structured Python
   *
   * For any valid CreateObjectParams (name: 1–63 alphanumeric/underscore characters,
   * geometryType from the allowed set, location/rotation/scale as float triples with
   * positive scale values), calling generateCreateObjectCode(params) SHALL produce a string
   * that contains the correct bpy.ops.mesh.primitive_*_add call matching the geometry type,
   * includes the name assignment obj.name = "{name}", and embeds the transform values as
   * Python float literals matching the input.
   *
   * Validates: Requirements 4.1
   */
  describe("Property 4: Create object codegen produces syntactically structured Python", () => {
    // Generator: name with 1-63 chars from [a-zA-Z0-9_]
    const nameArb = fc.stringOf(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".split(""),
      ),
      { minLength: 1, maxLength: 63 },
    );

    // Generator: one of the 9 allowed geometry types
    const geometryTypeArb = fc.constantFrom(...ALLOWED_GEOMETRY_TYPES);

    // Generator: float triple for location/rotation (arbitrary floats)
    const floatTripleArb = fc.tuple(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
    ) as fc.Arbitrary<[number, number, number]>;

    // Generator: float triple for scale (positive floats > 0)
    const positiveFloat = fc
      .double({
        min: Number.MIN_VALUE,
        max: 1e10,
        noNaN: true,
        noDefaultInfinity: true,
      })
      .filter((v) => v > 0);

    const scaleTripleArb = fc.tuple(positiveFloat, positiveFloat, positiveFloat) as fc.Arbitrary<
      [number, number, number]
    >;

    // Generator: full valid CreateObjectParams
    const createObjectParamsArb = fc.record({
      name: nameArb,
      geometryType: geometryTypeArb,
      location: floatTripleArb,
      rotation: floatTripleArb,
      scale: scaleTripleArb,
    });

    /** Helper: convert a number to the Python float literal representation matching the codegen. */
    function toPythonFloat(value: number): string {
      const str = String(value);
      if (str.includes(".") || str.includes("e") || str.includes("E")) {
        return str;
      }
      return str + ".0";
    }

    it("contains the correct bpy.ops call for the geometry type", () => {
      fc.assert(
        fc.property(createObjectParamsArb, (params) => {
          const code = generateCreateObjectCode(params);
          const expectedOps = GEOMETRY_OPS_MAP[params.geometryType];
          expect(code).toContain(expectedOps);
        }),
        { numRuns: 100 },
      );
    });

    it('contains obj.name = "{name}" with the exact name from params', () => {
      fc.assert(
        fc.property(createObjectParamsArb, (params) => {
          const code = generateCreateObjectCode(params);
          expect(code).toContain(`obj.name = "${params.name}"`);
        }),
        { numRuns: 100 },
      );
    });

    it("contains location tuple with the correct float values", () => {
      fc.assert(
        fc.property(createObjectParamsArb, (params) => {
          const code = generateCreateObjectCode(params);
          const [x, y, z] = params.location!;
          const expectedTuple = `(${toPythonFloat(x)}, ${toPythonFloat(y)}, ${toPythonFloat(z)})`;
          expect(code).toContain(`location=${expectedTuple}`);
        }),
        { numRuns: 100 },
      );
    });

    it("contains rotation tuple with the correct float values", () => {
      fc.assert(
        fc.property(createObjectParamsArb, (params) => {
          const code = generateCreateObjectCode(params);
          const [x, y, z] = params.rotation!;
          const expectedTuple = `(${toPythonFloat(x)}, ${toPythonFloat(y)}, ${toPythonFloat(z)})`;
          expect(code).toContain(`rotation=${expectedTuple}`);
        }),
        { numRuns: 100 },
      );
    });

    it("contains scale tuple with the correct float values", () => {
      fc.assert(
        fc.property(createObjectParamsArb, (params) => {
          const code = generateCreateObjectCode(params);
          const [x, y, z] = params.scale!;
          const expectedTuple = `(${toPythonFloat(x)}, ${toPythonFloat(y)}, ${toPythonFloat(z)})`;
          // Torus doesn't support scale as a parameter — it's applied post-creation via obj.scale
          if (params.geometryType === "torus") {
            expect(code).toContain(`obj.scale = ${expectedTuple}`);
          } else {
            expect(code).toContain(`scale=${expectedTuple}`);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("starts with import bpy", () => {
      fc.assert(
        fc.property(createObjectParamsArb, (params) => {
          const code = generateCreateObjectCode(params);
          expect(code.startsWith("import bpy")).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("contains result = at the end", () => {
      fc.assert(
        fc.property(createObjectParamsArb, (params) => {
          const code = generateCreateObjectCode(params);
          expect(code).toContain("result = ");
        }),
        { numRuns: 100 },
      );
    });
  });
});
