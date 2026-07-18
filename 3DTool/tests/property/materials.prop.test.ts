// Feature: 3dtool-viewer-improvements, Property 11: Material Partial Update
// **Validates: Requirements 6.1**
// Feature: 3dtool-viewer-improvements, Property 12: Material Range Validation
// **Validates: Requirements 6.6**

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";
import { SceneManager } from "../../src/scene-manager";
import type { MaterialProps, SceneObject } from "../../src/types";

/**
 * Property 12: Material Range Validation
 *
 * For any roughness or metalness value outside the range [0.0, 1.0],
 * setMaterial SHALL throw an error indicating the invalid property and
 * acceptable range, without modifying any material state.
 */

let tempDir: string;
let tempFile: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mat-range-"));
  tempFile = path.join(tempDir, "model.obj");
  fs.writeFileSync(tempFile, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "utf-8");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Helper: create a SceneManager with one object already added and a valid initial material
function setupSceneWithMaterial(): { manager: SceneManager; objectId: string } {
  const manager = new SceneManager();
  const objectId = "test-object";
  const obj: SceneObject = {
    id: objectId,
    filePath: path.relative(tempDir, tempFile),
    workspaceRoot: tempDir,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    materials: [],
  };
  manager.addObject(obj);
  // Set an initial valid material so we can snapshot it
  manager.setMaterial(objectId, {
    color: "#ff0000",
    roughness: 0.5,
    metalness: 0.3,
    emissive: "#000000",
  });
  return { manager, objectId };
}

// Generator for out-of-range roughness (< 0 or > 1)
const outOfRangeRoughness = fc
  .oneof(
    fc.double({ min: -1000, max: -Number.MIN_VALUE, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 1 + Number.MIN_VALUE, max: 1000, noNaN: true, noDefaultInfinity: true }),
  )
  .filter((v) => v < 0 || v > 1);

// Generator for out-of-range metalness (< 0 or > 1)
const outOfRangeMetalness = fc
  .oneof(
    fc.double({ min: -1000, max: -Number.MIN_VALUE, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 1 + Number.MIN_VALUE, max: 1000, noNaN: true, noDefaultInfinity: true }),
  )
  .filter((v) => v < 0 || v > 1);

describe("Property 12: Material Range Validation", () => {
  it("setMaterial throws for out-of-range roughness without modifying material state", () => {
    fc.assert(
      fc.property(outOfRangeRoughness, (roughness) => {
        const { manager, objectId } = setupSceneWithMaterial();

        // Snapshot material state before the invalid call
        const before = JSON.stringify(manager.listMaterials());

        // Attempt to set invalid roughness — should throw
        expect(() => {
          manager.setMaterial(objectId, { roughness });
        }).toThrow(/roughness/i);

        // Material state should be unchanged
        const after = JSON.stringify(manager.listMaterials());
        expect(after).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  it("setMaterial throws for out-of-range metalness without modifying material state", () => {
    fc.assert(
      fc.property(outOfRangeMetalness, (metalness) => {
        const { manager, objectId } = setupSceneWithMaterial();

        // Snapshot material state before the invalid call
        const before = JSON.stringify(manager.listMaterials());

        // Attempt to set invalid metalness — should throw
        expect(() => {
          manager.setMaterial(objectId, { metalness });
        }).toThrow(/metalness/i);

        // Material state should be unchanged
        const after = JSON.stringify(manager.listMaterials());
        expect(after).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  it("setMaterial throws for combined out-of-range roughness and metalness without state change", () => {
    fc.assert(
      fc.property(outOfRangeRoughness, outOfRangeMetalness, (roughness, metalness) => {
        const { manager, objectId } = setupSceneWithMaterial();

        // Snapshot material state before the invalid call
        const before = JSON.stringify(manager.listMaterials());

        // Attempt to set both invalid — should throw for at least one
        expect(() => {
          manager.setMaterial(objectId, { roughness, metalness });
        }).toThrow();

        // Material state should be unchanged
        const after = JSON.stringify(manager.listMaterials());
        expect(after).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 11: Material Partial Update
 *
 * For any object in the scene and any subset of material properties
 * (color, roughness, metalness, emissive), calling setMaterial with only
 * that subset SHALL update only the specified properties and leave
 * unspecified properties at their previous values.
 */

// Generator for valid hex color strings
const hexColor = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, "0")}`);

// Generator for roughness/metalness values in valid range [0.0, 1.0]
const unitFloat = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

// Generator for a full MaterialProps object (all properties set)
const fullMaterialProps: fc.Arbitrary<MaterialProps> = fc.record({
  color: hexColor,
  roughness: unitFloat,
  metalness: unitFloat,
  emissive: hexColor,
});

// Generator for a partial MaterialProps where at least one property is included
// and each property is independently included or excluded
const partialMaterialProps: fc.Arbitrary<Partial<MaterialProps>> = fc
  .record({
    includeColor: fc.boolean(),
    includeRoughness: fc.boolean(),
    includeMetalness: fc.boolean(),
    includeEmissive: fc.boolean(),
    color: hexColor,
    roughness: unitFloat,
    metalness: unitFloat,
    emissive: hexColor,
  })
  .filter((r) => r.includeColor || r.includeRoughness || r.includeMetalness || r.includeEmissive)
  .map((r) => {
    const partial: Partial<MaterialProps> = {};
    if (r.includeColor) partial.color = r.color;
    if (r.includeRoughness) partial.roughness = r.roughness;
    if (r.includeMetalness) partial.metalness = r.metalness;
    if (r.includeEmissive) partial.emissive = r.emissive;
    return partial;
  });

describe("Property 11: Material Partial Update", () => {
  it("applying a partial material update changes only specified properties and leaves others unchanged", () => {
    fc.assert(
      fc.property(fullMaterialProps, partialMaterialProps, (initialMaterial, partialUpdate) => {
        const manager = new SceneManager();
        const objectId = "test-partial-mat";

        // Add an object to the scene using the temp file
        manager.addObject({
          id: objectId,
          filePath: path.relative(tempDir, tempFile),
          workspaceRoot: tempDir,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          materials: [],
        });

        // Apply full material first to set known initial values
        manager.setMaterial(objectId, initialMaterial);

        // Verify initial state via listMaterials
        const beforeList = manager.listMaterials();
        const before = beforeList.find((m) => m.objectId === objectId)!;
        expect(before).toBeDefined();
        expect(before.color).toBe(initialMaterial.color);
        expect(before.roughness).toBe(initialMaterial.roughness);
        expect(before.metalness).toBe(initialMaterial.metalness);
        expect(before.emissive).toBe(initialMaterial.emissive);

        // Apply partial update
        manager.setMaterial(objectId, partialUpdate);

        // Get final state
        const afterList = manager.listMaterials();
        const after = afterList.find((m) => m.objectId === objectId)!;
        expect(after).toBeDefined();

        // Assert: provided props match new values
        if (partialUpdate.color !== undefined) {
          expect(after.color).toBe(partialUpdate.color);
        }
        if (partialUpdate.roughness !== undefined) {
          expect(after.roughness).toBe(partialUpdate.roughness);
        }
        if (partialUpdate.metalness !== undefined) {
          expect(after.metalness).toBe(partialUpdate.metalness);
        }
        if (partialUpdate.emissive !== undefined) {
          expect(after.emissive).toBe(partialUpdate.emissive);
        }

        // Assert: unprovided props remain at their previous values
        if (partialUpdate.color === undefined) {
          expect(after.color).toBe(initialMaterial.color);
        }
        if (partialUpdate.roughness === undefined) {
          expect(after.roughness).toBe(initialMaterial.roughness);
        }
        if (partialUpdate.metalness === undefined) {
          expect(after.metalness).toBe(initialMaterial.metalness);
        }
        if (partialUpdate.emissive === undefined) {
          expect(after.emissive).toBe(initialMaterial.emissive);
        }
      }),
      { numRuns: 100 },
    );
  });
});
