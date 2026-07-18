// Feature: poll-interactions-fix, Property 1: Bug Condition - Poll Drains Interactions Making Acknowledgment Impossible
// **Validates: Requirements 1.2, 1.3, 2.1, 2.3**

import path from "path";
import { fileURLToPath } from "url";
import * as fc from "fast-check";
import { SceneManager } from "../../src/scene-manager";

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

/**
 * Property 1: Bug Condition - Interactions Survive Polling for Acknowledgment
 *
 * For any interaction added to SceneManager, after pollInteractions() returns it,
 * acknowledgeInteraction(id) with that same ID SHALL return true.
 *
 * Bug Condition from design:
 *   isBugCondition({ action: "acknowledge" }) is true when
 *   interactionId IN previouslyPolledIds AND interactionId NOT IN sceneManager.interactions
 *
 * EXPECTED: This test FAILS on unfixed code because pollInteractions() drains
 * the interactions array (this.interactions = []), making acknowledgeInteraction()
 * unable to find the interaction.
 */

// Generator for random interaction input data
const interactionInputArb = fc.record({
  x: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  z: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  meshId: fc.string({ minLength: 1, maxLength: 32 }),
  prompt: fc.string({ minLength: 1, maxLength: 128 }),
  faceNormal: fc.record({
    x: fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
    z: fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
  }),
  faceIndex: fc.nat({ max: 100000 }),
  objectPath: fc.string({ minLength: 1, maxLength: 64 }),
  objectId: fc.string({ minLength: 1, maxLength: 64 }),
});

describe("Property 1: Bug Condition - Poll Drains Interactions Making Acknowledgment Impossible", () => {
  it("acknowledgeInteraction succeeds for a polled interaction ID (single interaction)", () => {
    fc.assert(
      fc.property(interactionInputArb, (input) => {
        const manager = new SceneManager();

        // Step 1: Add interaction
        const added = manager.addInteraction(input);
        expect(added.id).toBeDefined();
        expect(added.state).toBe("pending");

        // Step 2: Poll interactions - should return the added interaction
        const pollResult = manager.pollInteractions();
        expect(pollResult.events.length).toBe(1);
        expect(pollResult.events[0].id).toBe(added.id);

        // Step 3: Acknowledge the polled interaction - THIS IS THE BUG CONDITION
        // On unfixed code, this returns false because pollInteractions() drained the array
        const ackResult = manager.acknowledgeInteraction(added.id);
        expect(ackResult).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("acknowledgeInteraction succeeds for all polled IDs (multiple interactions interleaved)", () => {
    fc.assert(
      fc.property(fc.array(interactionInputArb, { minLength: 1, maxLength: 5 }), (inputs) => {
        const manager = new SceneManager();

        // Step 1: Add multiple interactions
        const addedIds: string[] = [];
        for (const input of inputs) {
          const added = manager.addInteraction(input);
          addedIds.push(added.id);
        }

        // Step 2: Poll interactions - should return all added interactions
        const pollResult = manager.pollInteractions();
        expect(pollResult.events.length).toBe(inputs.length);

        // Verify all added IDs appear in the poll result
        const polledIds = pollResult.events.map((e) => e.id);
        for (const id of addedIds) {
          expect(polledIds).toContain(id);
        }

        // Step 3: Acknowledge each polled interaction - BUG CONDITION
        // On unfixed code, ALL of these return false
        for (const id of addedIds) {
          const ackResult = manager.acknowledgeInteraction(id);
          expect(ackResult).toBe(true);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("addInteraction returns ID consistent with pollInteractions (no divergent IDs)", () => {
    fc.assert(
      fc.property(interactionInputArb, (input) => {
        const manager = new SceneManager();

        // Add interaction - get the ID from addInteraction's return value
        const added = manager.addInteraction(input);
        const returnedId = added.id;

        // Poll - get the ID from pollInteractions
        const pollResult = manager.pollInteractions();
        const polledId = pollResult.events[0].id;

        // The IDs MUST be the same - no divergent evt_/int_ IDs
        expect(returnedId).toBe(polledId);

        // Both should start with "int_" prefix (SceneManager's format)
        expect(returnedId).toMatch(/^int_/);
        expect(polledId).toMatch(/^int_/);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: poll-interactions-fix, Property 2: Preservation - Non-Interaction Operations Unchanged
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

/**
 * Property 2: Preservation - Non-Interaction Operations Unchanged
 *
 * For any operation that does NOT involve the interaction submission→poll→acknowledge
 * lifecycle, the system behaves correctly independently of interaction state.
 *
 * These tests capture baseline behavior on UNFIXED code that MUST be preserved after fix:
 * - Empty poll returns { events: [], cameraPosition: ... }
 * - Acknowledge with non-existent ID returns false
 * - Scene object operations work independently of interactions
 * - Camera position is included in poll results
 *
 * EXPECTED: These tests PASS on unfixed code (confirms baseline behavior to preserve)
 */

// Generator for valid scene object (requires real file path - use fixtures)
const sceneObjectArb = (workspaceRoot: string, filePath: string) =>
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
    filePath: fc.constant(filePath),
    workspaceRoot: fc.constant(workspaceRoot),
    position: fc.record({
      x: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
      y: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
      z: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
    }),
    rotation: fc.record({
      x: fc.double({ min: -360, max: 360, noNaN: true, noDefaultInfinity: true }),
      y: fc.double({ min: -360, max: 360, noNaN: true, noDefaultInfinity: true }),
      z: fc.double({ min: -360, max: 360, noNaN: true, noDefaultInfinity: true }),
    }),
    scale: fc.record({
      x: fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
      y: fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
      z: fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
    }),
    materials: fc.constant([]),
  });

// Generator for non-existent interaction IDs (strings that won't match any real interaction)
const nonExistentIdArb = fc.string({ minLength: 1, maxLength: 64 }).map((s) => `fake_${s}`);

// Generator for camera position (location + target)
const cameraPositionArb = fc.record({
  location: fc.record({
    x: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    z: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  }),
  target: fc.record({
    x: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    z: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  }),
});

describe("Property 2: Preservation - Non-Interaction Operations Unchanged", () => {
  const fixtureRoot = path.resolve(__dirname_esm, "../fixtures");
  const fixturePath = "cube.obj";

  it("pollInteractions with zero pending interactions returns empty events and current camera position", () => {
    fc.assert(
      fc.property(cameraPositionArb, (camera) => {
        const manager = new SceneManager();

        // Set camera position
        manager.setCameraPosition(camera.location, camera.target);

        // Poll with no interactions added
        const result = manager.pollInteractions();

        // Events must be an empty array
        expect(result.events).toEqual([]);

        // Camera position must match what was set
        expect(result.cameraPosition).not.toBeNull();
        expect(result.cameraPosition!.location.x).toBe(camera.location.x);
        expect(result.cameraPosition!.location.y).toBe(camera.location.y);
        expect(result.cameraPosition!.location.z).toBe(camera.location.z);
        expect(result.cameraPosition!.target.x).toBe(camera.target.x);
        expect(result.cameraPosition!.target.y).toBe(camera.target.y);
        expect(result.cameraPosition!.target.z).toBe(camera.target.z);
      }),
      { numRuns: 100 },
    );
  });

  it("pollInteractions with no camera set returns null cameraPosition and empty events", () => {
    fc.assert(
      fc.property(fc.nat({ max: 10 }), (_n) => {
        const manager = new SceneManager();

        // Poll without setting anything
        const result = manager.pollInteractions();

        expect(result.events).toEqual([]);
        expect(result.cameraPosition).toBeNull();
      }),
      { numRuns: 20 },
    );
  });

  it("acknowledgeInteraction with IDs that were never added returns false", () => {
    fc.assert(
      fc.property(nonExistentIdArb, (fakeId) => {
        const manager = new SceneManager();

        // Acknowledge a non-existent interaction
        const result = manager.acknowledgeInteraction(fakeId);

        // Must return false for non-existent IDs
        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("scene object add/list operations work independently of interaction state", () => {
    fc.assert(
      fc.property(
        sceneObjectArb(fixtureRoot, fixturePath),
        interactionInputArb,
        (obj, interaction) => {
          const manager = new SceneManager();

          // Add an interaction (creates interaction state)
          manager.addInteraction(interaction);

          // Scene object operations should work regardless of interaction state
          manager.addObject(obj);
          const objects = manager.listObjects();

          expect(objects.length).toBe(1);
          expect(objects[0].id).toBe(obj.id);
          expect(objects[0].filePath).toBe(obj.filePath);
          expect(objects[0].position).toEqual(obj.position);
          expect(objects[0].rotation).toEqual(obj.rotation);
          expect(objects[0].scale).toEqual(obj.scale);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("scene object remove/list operations work independently of interaction state", () => {
    fc.assert(
      fc.property(
        sceneObjectArb(fixtureRoot, fixturePath),
        interactionInputArb,
        (obj, interaction) => {
          const manager = new SceneManager();

          // Add interaction then object
          manager.addInteraction(interaction);
          manager.addObject(obj);

          // Remove the object
          manager.removeObject(obj.id);

          // List should be empty
          const objects = manager.listObjects();
          expect(objects.length).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("camera position via setCameraPosition is included in poll results", () => {
    fc.assert(
      fc.property(fc.array(cameraPositionArb, { minLength: 1, maxLength: 5 }), (positions) => {
        const manager = new SceneManager();

        // Update camera position multiple times
        for (const pos of positions) {
          manager.setCameraPosition(pos.location, pos.target);
        }

        // Poll should return the last camera position set
        const result = manager.pollInteractions();
        const lastPos = positions[positions.length - 1];

        expect(result.cameraPosition).not.toBeNull();
        expect(result.cameraPosition!.location.x).toBe(lastPos.location.x);
        expect(result.cameraPosition!.location.y).toBe(lastPos.location.y);
        expect(result.cameraPosition!.location.z).toBe(lastPos.location.z);
        expect(result.cameraPosition!.target.x).toBe(lastPos.target.x);
        expect(result.cameraPosition!.target.y).toBe(lastPos.target.y);
        expect(result.cameraPosition!.target.z).toBe(lastPos.target.z);
      }),
      { numRuns: 50 },
    );
  });

  it("SSE broadcast for pin_state resolved works for valid acknowledgment flows (without prior poll)", () => {
    fc.assert(
      fc.property(interactionInputArb, (input) => {
        const manager = new SceneManager();

        // Add interaction
        const added = manager.addInteraction(input);
        expect(added.state).toBe("pending");

        // Acknowledge WITHOUT polling first (non-buggy path: interaction is still in array)
        const ackResult = manager.acknowledgeInteraction(added.id);
        expect(ackResult).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: 3dtool-viewer-improvements, Property 17: Camera Position in Poll Response
// **Validates: Requirements 10.2**

/**
 * Property 17: Camera Position in Poll Response
 *
 * For any call to pollInteractions when a camera position has been reported
 * by the viewer, the response SHALL include a camera_position field containing
 * location {x, y, z} and target {x, y, z} matching the last reported values.
 */

// Generator for Vec3 with finite float values
const vec3Arb = fc.record({
  x: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  z: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
});

describe("Property 17: Camera Position in Poll Response", () => {
  it("pollInteractions returns cameraPosition matching the last setCameraPosition values", () => {
    fc.assert(
      fc.property(vec3Arb, vec3Arb, (location, target) => {
        const manager = new SceneManager();

        // Set camera position
        manager.setCameraPosition(location, target);

        // Poll interactions
        const result = manager.pollInteractions();

        // Assert cameraPosition is not null
        expect(result.cameraPosition).not.toBeNull();

        // Assert location matches
        expect(result.cameraPosition!.location.x).toBe(location.x);
        expect(result.cameraPosition!.location.y).toBe(location.y);
        expect(result.cameraPosition!.location.z).toBe(location.z);

        // Assert target matches
        expect(result.cameraPosition!.target.x).toBe(target.x);
        expect(result.cameraPosition!.target.y).toBe(target.y);
        expect(result.cameraPosition!.target.z).toBe(target.z);
      }),
      { numRuns: 100 },
    );
  });

  it("pollInteractions returns null cameraPosition when no camera position has been set", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const manager = new SceneManager();

        // Poll without setting camera position
        const result = manager.pollInteractions();

        // Assert cameraPosition is null
        expect(result.cameraPosition).toBeNull();
      }),
      { numRuns: 1 },
    );
  });

  it("pollInteractions returns the most recent camera position when set multiple times", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(vec3Arb, vec3Arb), { minLength: 1, maxLength: 10 }),
        (positions) => {
          const manager = new SceneManager();

          // Set camera position multiple times
          for (const [location, target] of positions) {
            manager.setCameraPosition(location, target);
          }

          // Poll interactions
          const result = manager.pollInteractions();

          // Should match the last set values
          const [lastLocation, lastTarget] = positions[positions.length - 1];

          expect(result.cameraPosition).not.toBeNull();
          expect(result.cameraPosition!.location.x).toBe(lastLocation.x);
          expect(result.cameraPosition!.location.y).toBe(lastLocation.y);
          expect(result.cameraPosition!.location.z).toBe(lastLocation.z);
          expect(result.cameraPosition!.target.x).toBe(lastTarget.x);
          expect(result.cameraPosition!.target.y).toBe(lastTarget.y);
          expect(result.cameraPosition!.target.z).toBe(lastTarget.z);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: 3dtool-viewer-improvements, Property 6: Annotation Face Normal Unit Vector
// **Validates: Requirements 4.1**

/**
 * Property 6: Annotation Face Normal Unit Vector
 *
 * For any Interaction_Event where faceNormal is not the fallback value {0,0,0},
 * the magnitude sqrt(x² + y² + z²) of faceNormal SHALL equal 1.0 within
 * floating-point epsilon (±0.001).
 */

// Generator for non-zero Vec3 that gets normalized (simulating viewer behavior)
const nonZeroVec3Arb = fc
  .record({
    x: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    z: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  })
  .filter(({ x, y, z }) => {
    // Exclude zero vector (the fallback value)
    const mag = Math.sqrt(x * x + y * y + z * z);
    return mag > 1e-10;
  })
  .map(({ x, y, z }) => {
    // Normalize to unit vector (what the viewer does)
    const mag = Math.sqrt(x * x + y * y + z * z);
    return { x: x / mag, y: y / mag, z: z / mag };
  });

describe("Property 6: Annotation Face Normal Unit Vector", () => {
  it("faceNormal magnitude is ≈ 1.0 (±0.001) after round-trip through SceneManager", () => {
    fc.assert(
      fc.property(nonZeroVec3Arb, (faceNormal) => {
        const manager = new SceneManager();

        // Add an interaction with the normalized faceNormal
        manager.addInteraction({
          x: 0,
          y: 0,
          z: 0,
          meshId: "testMesh",
          prompt: "test annotation",
          faceNormal,
          faceIndex: 0,
          objectPath: "Root/TestMesh",
          objectId: "obj-1",
        });

        // Poll interactions to retrieve the event
        const result = manager.pollInteractions();
        expect(result.events.length).toBe(1);

        const returnedNormal = result.events[0].faceNormal;

        // Compute magnitude of returned faceNormal
        const magnitude = Math.sqrt(
          returnedNormal.x * returnedNormal.x +
            returnedNormal.y * returnedNormal.y +
            returnedNormal.z * returnedNormal.z,
        );

        // Assert magnitude is approximately 1.0
        expect(Math.abs(magnitude - 1.0)).toBeLessThanOrEqual(0.001);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: 3dtool-viewer-improvements, Property 7: Interaction Event Enrichment Round-Trip
// **Validates: Requirements 4.4, 4.5**

/**
 * Property 7: Interaction Event Enrichment Round-Trip
 *
 * For any interaction submitted to the queue with enriched fields (faceNormal,
 * faceIndex, objectPath, objectId), pollInteractions SHALL return that interaction
 * with all enriched fields preserved exactly as submitted.
 */

// Generator for Vec3 with finite float values
const enrichedVec3Arb = fc.record({
  x: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  z: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
});

// Generator for a slash-separated object path (e.g. "Root/Group/Mesh")
const objectPathArb = fc
  .array(
    fc.string({ minLength: 1, maxLength: 16 }).filter((s) => !s.includes("/")),
    {
      minLength: 1,
      maxLength: 5,
    },
  )
  .map((parts) => parts.join("/"));

// Generator for a full interaction input with enriched fields
const enrichedInteractionArb = fc.record({
  x: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  z: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  meshId: fc.string({ minLength: 1, maxLength: 32 }),
  prompt: fc.string({ minLength: 1, maxLength: 128 }),
  faceNormal: enrichedVec3Arb,
  faceIndex: fc.nat({ max: 100000 }),
  objectPath: objectPathArb,
  objectId: fc.string({ minLength: 1, maxLength: 64 }),
});

describe("Property 7: Interaction Event Enrichment Round-Trip", () => {
  it("pollInteractions returns interaction with all enriched fields preserved exactly as submitted", () => {
    fc.assert(
      fc.property(enrichedInteractionArb, (input) => {
        const manager = new SceneManager();

        // Submit interaction with enriched fields
        manager.addInteraction(input);

        // Poll interactions
        const result = manager.pollInteractions();

        // There should be exactly one event
        expect(result.events).toHaveLength(1);
        const event = result.events[0];

        // Assert base fields preserved
        expect(event.x).toBe(input.x);
        expect(event.y).toBe(input.y);
        expect(event.z).toBe(input.z);
        expect(event.meshId).toBe(input.meshId);
        expect(event.prompt).toBe(input.prompt);

        // Assert enriched fields preserved exactly
        expect(event.faceNormal.x).toBe(input.faceNormal.x);
        expect(event.faceNormal.y).toBe(input.faceNormal.y);
        expect(event.faceNormal.z).toBe(input.faceNormal.z);
        expect(event.faceIndex).toBe(input.faceIndex);
        expect(event.objectPath).toBe(input.objectPath);
        expect(event.objectId).toBe(input.objectId);

        // Assert system-generated fields exist
        expect(event.id).toBeDefined();
        expect(event.timestamp).toBeGreaterThan(0);
        expect(event.state).toBe("pending");
      }),
      { numRuns: 100 },
    );
  });
});
