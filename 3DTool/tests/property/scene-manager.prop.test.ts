// Feature: 3dtool-viewer-improvements
// Property 8: Scene Object Add/List Consistency
// Property 9: Duplicate Object Identifier Rejection
// Property 10: Transform Partial Update
// **Validates: Requirements 5.1, 5.3, 5.4, 5.7**

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";
import { SceneManager } from "../../src/scene-manager";
import type { SceneObject, Vec3 } from "../../src/types";

/**
 * Property 8: Scene Object Add/List Consistency
 *
 * For any sequence of add_object and remove_object operations,
 * listObjects SHALL return exactly the set of objects that have been
 * added but not removed, each with its correct identifier, filePath,
 * and current transform values.
 */

// The workspace root and fixture path used for Property 8 tests.
// SceneManager.addObject validates file existence, so we use a real fixture.
import { fileURLToPath } from "url";
const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const workspaceRootProp8 = path.resolve(__dirnameLocal, "../..");
const fixturePathProp8 = "tests/fixtures/cube.obj";

// Generator for unique object IDs (1-64 chars, alphanumeric + dashes)
const objectIdProp8 = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")),
  { minLength: 1, maxLength: 20 },
);

// Operation type: either add or remove
type AddOp = { type: "add"; obj: SceneObject };
type RemoveOp = { type: "remove"; id: string };
type Op = AddOp | RemoveOp;

// Vec3 generator for Property 8
const vec3Prop8: fc.Arbitrary<Vec3> = fc.record({
  x: fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
  z: fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
});

// Generator for a SceneObject with the given id (using the real fixture)
function makeSceneObj(id: string, pos: Vec3, rot: Vec3, scale: Vec3): SceneObject {
  return {
    id,
    filePath: fixturePathProp8,
    workspaceRoot: workspaceRootProp8,
    position: pos,
    rotation: rot,
    scale: scale,
    materials: [],
  };
}

// Generator for a sequence of add/remove operations with valid semantics:
// - Each add uses a unique ID
// - Each remove targets an ID that was previously added and not yet removed
const operationSequence: fc.Arbitrary<Op[]> = fc
  .tuple(
    fc.integer({ min: 1, max: 15 }), // number of operations
    fc.infiniteStream(objectIdProp8), // stream of candidate IDs
    fc.infiniteStream(vec3Prop8), // stream of positions
    fc.infiniteStream(vec3Prop8), // stream of rotations
    fc.infiniteStream(vec3Prop8), // stream of scales
    fc.infiniteStream(fc.integer({ min: 0, max: 9 })), // add/remove decisions
    fc.infiniteStream(fc.nat()), // remove index seeds
  )
  .map(([numOps, idStream, posStream, rotStream, scaleStream, decisionStream, removeIdxStream]) => {
    const ops: Op[] = [];
    const activeIds: string[] = [];
    const usedIds = new Set<string>();

    const ids = [...take(idStream, numOps * 10)]; // pre-take enough IDs
    const positions = [...take(posStream, numOps)];
    const rotations = [...take(rotStream, numOps)];
    const scales = [...take(scaleStream, numOps)];
    const decisions = [...take(decisionStream, numOps)];
    const removeIdxSeeds = [...take(removeIdxStream, numOps)];

    let idCursor = 0;
    let vecCursor = 0;

    for (let i = 0; i < numOps; i++) {
      const canRemove = activeIds.length > 0;
      const doAdd = !canRemove || decisions[i] < 6;

      if (doAdd) {
        // Find a unique ID
        let id = ids[idCursor++ % ids.length];
        while (usedIds.has(id)) {
          id = ids[idCursor++ % ids.length];
          if (idCursor > ids.length * 2) {
            // Fallback: append index to avoid infinite loop
            id = `${id}_${i}`;
            break;
          }
        }
        usedIds.add(id);

        const obj = makeSceneObj(
          id,
          positions[vecCursor % positions.length],
          rotations[vecCursor % rotations.length],
          scales[vecCursor % scales.length],
        );
        vecCursor++;

        ops.push({ type: "add", obj });
        activeIds.push(id);
      } else {
        // Remove a random active object
        const removeIndex = removeIdxSeeds[i] % activeIds.length;
        const id = activeIds[removeIndex];
        activeIds.splice(removeIndex, 1);
        ops.push({ type: "remove", id });
      }
    }

    return ops;
  })
  .filter((ops) => ops.length > 0);

// Helper to take N items from an infinite stream
function* take<T>(stream: fc.Stream<T>, n: number): Generator<T> {
  let count = 0;
  for (const item of stream) {
    if (count >= n) break;
    yield item;
    count++;
  }
}

describe("Property 8: Scene Object Add/List Consistency", () => {
  it("listObjects returns exactly the set of objects added but not removed, with correct identifiers, filePaths, and transforms", () => {
    fc.assert(
      fc.property(operationSequence, (ops) => {
        const manager = new SceneManager();
        const expected = new Map<string, SceneObject>();

        // Execute all operations
        for (const op of ops) {
          if (op.type === "add") {
            manager.addObject(op.obj);
            expected.set(op.obj.id, op.obj);
          } else {
            manager.removeObject(op.id);
            expected.delete(op.id);
          }
        }

        // Assert listObjects matches expected set
        const listed = manager.listObjects();

        // Same number of objects
        expect(listed.length).toBe(expected.size);

        // Each listed object matches the expected properties
        for (const listedObj of listed) {
          const expectedObj = expected.get(listedObj.id);
          expect(expectedObj).toBeDefined();

          // Verify identifier
          expect(listedObj.id).toBe(expectedObj!.id);

          // Verify filePath
          expect(listedObj.filePath).toBe(expectedObj!.filePath);

          // Verify transform values
          expect(listedObj.position.x).toBe(expectedObj!.position.x);
          expect(listedObj.position.y).toBe(expectedObj!.position.y);
          expect(listedObj.position.z).toBe(expectedObj!.position.z);

          expect(listedObj.rotation.x).toBe(expectedObj!.rotation.x);
          expect(listedObj.rotation.y).toBe(expectedObj!.rotation.y);
          expect(listedObj.rotation.z).toBe(expectedObj!.rotation.z);

          expect(listedObj.scale.x).toBe(expectedObj!.scale.x);
          expect(listedObj.scale.y).toBe(expectedObj!.scale.y);
          expect(listedObj.scale.z).toBe(expectedObj!.scale.z);
        }

        // Verify all expected objects are present
        for (const [id] of expected) {
          const found = listed.find((obj) => obj.id === id);
          expect(found).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 10: Transform Partial Update
 *
 * For any object in the scene and any subset of transform fields (position,
 * rotation, scale), calling transformObject with only that subset SHALL update
 * only the specified fields and leave all unspecified fields at their previous values.
 */

// Generator for Vec3 values
const vec3Arb: fc.Arbitrary<Vec3> = fc.record({
  x: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  z: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
});

// Generator for a boolean mask indicating which transform fields to include
const transformMaskArb = fc
  .record({
    includePosition: fc.boolean(),
    includeRotation: fc.boolean(),
    includeScale: fc.boolean(),
  })
  .filter(
    (mask) =>
      // At least one field must be included for the partial transform to be meaningful
      mask.includePosition || mask.includeRotation || mask.includeScale,
  );

describe("Property 10: Transform Partial Update", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-transform-"));
    tempFile = path.join(tempDir, "model.obj");
    fs.writeFileSync(tempFile, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("applying a partial transform updates only specified fields and leaves others unchanged", () => {
    fc.assert(
      fc.property(
        vec3Arb, // initial position
        vec3Arb, // initial rotation
        vec3Arb, // initial scale
        vec3Arb, // new position value (used if includePosition)
        vec3Arb, // new rotation value (used if includeRotation)
        vec3Arb, // new scale value (used if includeScale)
        transformMaskArb,
        (initialPos, initialRot, initialScale, newPos, newRot, newScale, mask) => {
          const manager = new SceneManager();

          // Add an object with known initial transforms
          const obj: SceneObject = {
            id: "test-obj",
            filePath: path.relative(tempDir, tempFile),
            workspaceRoot: tempDir,
            position: { ...initialPos },
            rotation: { ...initialRot },
            scale: { ...initialScale },
            materials: [],
          };

          manager.addObject(obj);

          // Build the partial transform based on the mask
          const partialTransform: Partial<{ position: Vec3; rotation: Vec3; scale: Vec3 }> = {};
          if (mask.includePosition) partialTransform.position = { ...newPos };
          if (mask.includeRotation) partialTransform.rotation = { ...newRot };
          if (mask.includeScale) partialTransform.scale = { ...newScale };

          // Apply the partial transform
          manager.transformObject("test-obj", partialTransform);

          // Get the updated object
          const objects = manager.listObjects();
          expect(objects).toHaveLength(1);
          const updated = objects[0];

          // Assert: provided fields match new values
          if (mask.includePosition) {
            expect(updated.position).toEqual(newPos);
          } else {
            // Unspecified field remains at initial value
            expect(updated.position).toEqual(initialPos);
          }

          if (mask.includeRotation) {
            expect(updated.rotation).toEqual(newRot);
          } else {
            expect(updated.rotation).toEqual(initialRot);
          }

          if (mask.includeScale) {
            expect(updated.scale).toEqual(newScale);
          } else {
            expect(updated.scale).toEqual(initialScale);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 9: Duplicate Object Identifier Rejection
 *
 * For any object identifier already present in the scene, calling addObject with
 * that same identifier SHALL throw an error and SHALL NOT modify the scene state
 * (listObjects returns the same result before and after the call).
 */

// Generator for valid object identifiers (1-64 printable ASCII characters)
const objectIdArb = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("")),
  { minLength: 1, maxLength: 64 },
);

describe("Property 9: Duplicate Object Identifier Rejection", () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-dup-"));
    tempFile = path.join(tempDir, "model.obj");
    fs.writeFileSync(tempFile, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("adding an object with a duplicate id throws an error and does not modify the scene", () => {
    fc.assert(
      fc.property(objectIdArb, (id) => {
        const manager = new SceneManager();

        const obj: SceneObject = {
          id,
          filePath: path.relative(tempDir, tempFile),
          workspaceRoot: tempDir,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          materials: [],
        };

        // Add the object successfully the first time
        manager.addObject(obj);

        // Snapshot the scene state before the duplicate attempt
        const before = manager.listObjects();

        // Attempting to add with the same id should throw
        expect(() => manager.addObject(obj)).toThrow();

        // Scene state must be unchanged after the failed add
        const after = manager.listObjects();
        expect(after).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});
