// Feature: 3dtool-viewer-improvements, Property 2: OBJ Validation Round-Trip
// **Validates: Requirements 3.5, 3.7**

import * as fc from "fast-check";
import { validateObj } from "../../src/obj-validator";

/**
 * Property 2: OBJ Validation Round-Trip (Valid Content)
 *
 * For any well-formed OBJ content (where all face indices reference existing
 * vertices, all lines conform to OBJ keyword grammar, and no orphan vertices
 * exist), the validator SHALL return a ValidationReport with valid=true,
 * an empty errors array, and an empty warnings array.
 */

/**
 * Generator strategy:
 * - Generate N vertices (random float coords) on a plane (z=0) to ensure
 *   consistent face winding (all normals point in +z direction)
 * - Generate faces that only reference indices [1..N] using fan triangulation
 * - Ensure ALL vertices are referenced by at least one face
 * - Optionally include comments, blank lines, valid keywords (g, o, s, usemtl, mtllib, vt, vn)
 * - Assemble into a valid OBJ string
 *
 * To avoid inconsistent winding warnings, all faces are constructed on the XY
 * plane with counter-clockwise ordering when viewed from +Z. This guarantees
 * all face normals point in the same direction (+Z).
 */

// Generate a float coordinate suitable for OBJ vertex data
const objFloat = fc
  .double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
  .map((n) => Number(n.toFixed(4)));

// Generate optional comment lines
const commentLine = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz 0123456789".split("")), {
    minLength: 0,
    maxLength: 30,
  })
  .map((text) => `# ${text}`);

// Generate optional blank lines
const blankLine = fc.constant("");

// Generate optional valid keyword lines (that don't affect face/vertex validation)
const groupLine = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_".split("")), {
    minLength: 1,
    maxLength: 15,
  })
  .map((name) => `g ${name}`);

const objectLine = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_".split("")), {
    minLength: 1,
    maxLength: 15,
  })
  .map((name) => `o ${name}`);

const smoothingLine = fc.oneof(fc.constant("s off"), fc.constant("s 1"), fc.constant("s 0"));

const usemtlLine = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_".split("")), {
    minLength: 1,
    maxLength: 15,
  })
  .map((name) => `usemtl ${name}`);

const mtllibLine = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_.".split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .map((name) => `mtllib ${name}`);

// Generate texture coordinate line
const vtLine = fc.tuple(objFloat, objFloat).map(([u, v]) => `vt ${u} ${v}`);

// Generate vertex normal line
const vnLine = fc.tuple(objFloat, objFloat, objFloat).map(([x, y, z]) => `vn ${x} ${y} ${z}`);

// Optional decorative line that doesn't affect vertex/face validation
const decorativeLine = fc.oneof(
  commentLine,
  blankLine,
  groupLine,
  objectLine,
  smoothingLine,
  usemtlLine,
  mtllibLine,
  vtLine,
  vnLine,
);

/**
 * Generates a valid OBJ string where:
 * - All face indices are within [1..N]
 * - All vertices are referenced by at least one face
 * - All faces have consistent winding (constructed on XY plane, CCW from +Z)
 * - No syntax errors exist
 */
const validObjContent = fc
  .tuple(
    fc.integer({ min: 3, max: 30 }),
    fc.double({ min: 1, max: 100, noNaN: true, noDefaultInfinity: true }),
  )
  .chain(([vertexCount, radius]) => {
    // Generate vertices arranged in a REGULAR circle on the XY plane
    // (fixed radius ensures the polygon is convex). Fan-triangulating a
    // convex polygon from vertex 1 always produces consistent CCW winding
    // when vertices are ordered counter-clockwise, so all face normals
    // point in the +Z direction.
    const verts: string[] = [];
    for (let i = 0; i < vertexCount; i++) {
      const angle = (2 * Math.PI * i) / vertexCount;
      const x = (radius * Math.cos(angle)).toFixed(4);
      const y = (radius * Math.sin(angle)).toFixed(4);
      verts.push(`v ${x} ${y} 0`);
    }

    // Fan triangulation from vertex 1: ensures all vertices are referenced
    // and all faces have consistent CCW winding from +Z view
    const fanFaces: string[] = [];
    for (let i = 2; i < vertexCount; i++) {
      fanFaces.push(`f ${1} ${i} ${i + 1}`);
    }

    // Generate decorative lines to optionally intersperse
    const decorations = fc.array(decorativeLine, { minLength: 0, maxLength: 8 });

    return decorations.map((decor) => {
      const lines: string[] = [];

      // Add some leading decorations (comments, group, etc.)
      const leading = decor.slice(0, Math.min(3, decor.length));
      lines.push(...leading);

      // Add all vertices
      lines.push(...verts);

      // Add middle decorations
      const middle = decor.slice(3, Math.min(6, decor.length));
      lines.push(...middle);

      // Add all faces
      lines.push(...fanFaces);

      // Add trailing decorations
      const trailing = decor.slice(6);
      lines.push(...trailing);

      return lines.join("\n");
    });
  });

describe("Property 2: OBJ Validation Round-Trip (Valid Content)", () => {
  it("returns valid=true with empty errors and warnings for any well-formed OBJ content", () => {
    fc.assert(
      fc.property(validObjContent, (objContent) => {
        const report = validateObj(objContent);

        expect(report.valid).toBe(true);
        expect(report.errors).toEqual([]);
        expect(report.warnings).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
