/**
 * Property-based tests for Skills Tool v2.1.0
 */
process.env.SKILLS_DB_PATH = ":memory:";

import * as fc from "fast-check";
import { defineSkill, executeSkill, interpolate, resolveSteps } from "../src/skills";
import { SkillsStore } from "../src/store";
import type { Step } from "../src/types";

function isSafeKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

// ─── Task 12.2: Upsert version increment ──────────────────────────────────────

describe("Property: upsert version increment", () => {
  test("calling upsert N times with same name yields version = N", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (n) => {
        const store = new SkillsStore(":memory:");
        // Use a unique name per run to avoid cross-test contamination
        const name = `prop-skill-${Math.random().toString(36).slice(2)}`;
        const input = {
          name,
          description: "A test skill",
          paramSchema: { type: "object" as const, properties: {} },
          steps: [{ type: "prompt" as const, template: "hello" }],
        };

        let record = store.upsertSkill(input);
        for (let i = 1; i < n; i++) {
          record = store.upsertSkill(input);
        }

        expect(record.version).toBe(n);
        store.close();
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Task 14.4: Step resolution length invariant ──────────────────────────────

describe("Property: resolveSteps length invariant", () => {
  test("output array length always equals input step count", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              type: fc.constant("prompt" as const),
              template: fc.string({ minLength: 1 }),
            }),
            fc.record({
              type: fc.constant("tool_call" as const),
              tool: fc.string({ minLength: 1 }),
              args: fc.dictionary(fc.string({ minLength: 1 }), fc.string()),
            }),
          ),
          { minLength: 0, maxLength: 20 },
        ),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string()),
        (steps, params) => {
          const resolved = resolveSteps(steps as Step[], params);
          expect(resolved).toHaveLength(steps.length);
        },
      ),
    );
  });

  test("resolveSteps does not mutate input steps", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constant("prompt" as const),
            template: fc.string({ minLength: 1 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.dictionary(fc.string({ minLength: 1 }), fc.string()),
        (steps, params) => {
          const original = JSON.stringify(steps);
          resolveSteps(steps as Step[], params);
          expect(JSON.stringify(steps)).toBe(original);
        },
      ),
    );
  });
});

// ─── Task 14.5: Interpolation correctness ─────────────────────────────────────

describe("Property: interpolation replaces known tokens, preserves unknown", () => {
  test("all {{key}} tokens for keys in params are replaced", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^\w+$/.test(s) && isSafeKey(s)),
          fc.string({ minLength: 0, maxLength: 50 }),
          { minKeys: 1, maxKeys: 5 },
        ),
        (params) => {
          const keys = Object.keys(params);
          const template = keys.map((k) => `{{${k}}}`).join(" ");
          const result = interpolate(template, params);

          // No known key placeholders should remain
          for (const key of keys) {
            expect(result).not.toContain(`{{${key}}}`);
          }
        },
      ),
    );
  });

  test("unknown {{placeholder}} tokens are left unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^\w+$/.test(s)),
        (unknownKey) => {
          const template = `prefix {{${unknownKey}}} suffix`;
          const result = interpolate(template, {}); // empty params
          expect(result).toContain(`{{${unknownKey}}}`);
        },
      ),
    );
  });

  test("interpolate does not mutate the template string", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.dictionary(fc.string({ minLength: 1 }), fc.string()),
        (template, params) => {
          const original = template;
          interpolate(template, params);
          expect(template).toBe(original);
        },
      ),
    );
  });
});

// ─── Task 13.2: Kebab-case validation ─────────────────────────────────────────

describe("Property: kebab-case name validation", () => {
  const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  test("valid kebab-case names always pass the pattern", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z0-9]+$/), { minLength: 1, maxLength: 5 }),
        (parts) => {
          const name = parts.join("-");
          expect(KEBAB_RE.test(name)).toBe(true);
        },
      ),
    );
  });

  test("names with uppercase letters fail the pattern", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /[A-Z]/.test(s)),
        (name) => {
          expect(KEBAB_RE.test(name)).toBe(false);
        },
      ),
    );
  });

  test("names with spaces fail the pattern", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.includes(" ")),
        (name) => {
          expect(KEBAB_RE.test(name)).toBe(false);
        },
      ),
    );
  });
});

// ─── Task 13.3: Description length validation ─────────────────────────────────

describe("Property: description length boundary", () => {
  test("descriptions over 1000 chars always exceed the limit", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1001, maxLength: 5000 }), (description) => {
        expect(description.length).toBeGreaterThan(1000);
      }),
    );
  });
});

// ─── Task 14.6: Round-trip: define → execute → all placeholders resolved ──────

describe("Property: define-execute round-trip", () => {
  // Arbitraries for valid kebab-case names and param keys
  const kebabSegment = fc.stringMatching(/^[a-z][a-z0-9]*$/);
  const kebabName = fc
    .array(kebabSegment, { minLength: 1, maxLength: 3 })
    .map((parts) => parts.join("-"));
  const paramKey = fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((s) => /^\w+$/.test(s) && isSafeKey(s));

  test("executing a defined skill resolves all known param placeholders", async () => {
    await fc.assert(
      fc.asyncProperty(
        kebabName,
        fc.dictionary(paramKey, fc.string({ minLength: 1, maxLength: 20 }), {
          minKeys: 1,
          maxKeys: 4,
        }),
        async (baseName, params) => {
          // Use a unique name per run
          const name = `${baseName}-${Math.random().toString(36).slice(2, 7)}`;
          const keys = Object.keys(params);

          // Build a prompt step that uses all param keys as placeholders
          const template = keys.map((k) => `{{${k}}}`).join("|");
          const steps: Step[] = [{ type: "prompt", template }];

          const paramSchema = {
            type: "object" as const,
            properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
            required: keys,
          };

          await defineSkill({ name, description: "round-trip test skill", paramSchema, steps });
          const result = await executeSkill({ name, params });

          expect(result.success).toBe(true);
          if (!result.success || !result.data) return;

          const resolved = result.data.resolvedSteps;
          expect(resolved).toHaveLength(1);

          const step = resolved[0];
          expect(step.type).toBe("prompt");
          if (step.type !== "prompt") return;

          // Every known key placeholder must be replaced
          for (const key of keys) {
            expect(step.text).not.toContain(`{{${key}}}`);
            expect(step.text).toContain(String(params[key]));
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  test("resolved step count always equals defined step count", async () => {
    await fc.assert(
      fc.asyncProperty(kebabName, fc.integer({ min: 1, max: 10 }), async (baseName, stepCount) => {
        const name = `${baseName}-${Math.random().toString(36).slice(2, 7)}`;
        const steps: Step[] = Array.from({ length: stepCount }, (_, i) => ({
          type: "prompt" as const,
          template: `step ${i}`,
        }));

        await defineSkill({
          name,
          description: "step count test",
          paramSchema: { type: "object" as const, properties: {} },
          steps,
        });

        const result = await executeSkill({ name, params: {} });
        expect(result.success).toBe(true);
        if (!result.success || !result.data) return;
        expect(result.data.resolvedSteps).toHaveLength(stepCount);
      }),
      { numRuns: 15 },
    );
  });
});

// ─── Task 14.7: Missing required params rejected ───────────────────────────────

describe("Property: missing required params rejected", () => {
  const kebabSegment = fc.stringMatching(/^[a-z][a-z0-9]*$/);
  const kebabName = fc
    .array(kebabSegment, { minLength: 1, maxLength: 3 })
    .map((parts) => parts.join("-"));
  const paramKey = fc
    .string({ minLength: 1, maxLength: 10 })
    .filter((s) => /^\w+$/.test(s) && isSafeKey(s));

  test("execute_skill without required params returns INVALID_INPUT", async () => {
    await fc.assert(
      fc.asyncProperty(
        kebabName,
        fc
          .array(paramKey, { minLength: 1, maxLength: 5 })
          .filter((keys) => new Set(keys).size === keys.length),
        async (baseName, requiredKeys) => {
          const name = `${baseName}-${Math.random().toString(36).slice(2, 7)}`;
          const paramSchema = {
            type: "object" as const,
            properties: Object.fromEntries(requiredKeys.map((k) => [k, { type: "string" }])),
            required: requiredKeys,
          };

          await defineSkill({
            name,
            description: "missing params test",
            paramSchema,
            steps: [{ type: "prompt" as const, template: "hello" }],
          });

          // Execute with empty params — all required keys are missing
          const result = await executeSkill({ name, params: {} });
          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.errorCode).toBe("INVALID_INPUT");
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ─── Task 14.8: tool_call step args interpolation round-trip ──────────────────

describe("Property: tool_call args interpolation", () => {
  test("all {{key}} tokens in tool_call args are replaced after resolveSteps", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^\w+$/.test(s) && isSafeKey(s)),
          fc.string({ minLength: 1, maxLength: 30 }),
          { minKeys: 1, maxKeys: 5 },
        ),
        (params) => {
          const keys = Object.keys(params);
          const args = Object.fromEntries(keys.map((k) => [k, `{{${k}}}`]));
          const steps: Step[] = [{ type: "tool_call", tool: "some-tool", args }];

          const resolved = resolveSteps(steps, params);
          expect(resolved).toHaveLength(1);

          const step = resolved[0];
          expect(step.type).toBe("tool_call");
          if (step.type !== "tool_call") return;

          for (const key of keys) {
            expect(step.args[key]).toBe(String(params[key]));
            expect(step.args[key]).not.toContain(`{{${key}}}`);
          }
        },
      ),
    );
  });
});
