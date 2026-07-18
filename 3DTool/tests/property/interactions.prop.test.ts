// Feature: 3dtool-viewer-improvements, Property 17: Camera Position in Poll Response
// **Validates: Requirements 10.2**

import * as fc from "fast-check";
import { SceneManager } from "../../src/scene-manager";

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
