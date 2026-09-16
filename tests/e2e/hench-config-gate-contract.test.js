/**
 * Cross-package contract: the dashboard's hench-config write gate must never
 * accept a value that hench's own schema rejects.
 *
 * Three dashboard routes write `.hench/config.json` — `PUT /api/hench/config`,
 * `POST /api/hench/adaptive/apply`, and `POST /api/hench/adaptive/override`.
 * All three share one gate, `validateFieldValue` in
 * `packages/web/src/server/hench-config-fields.ts`, and none of them consults
 * hench. Web cannot import hench's `HenchConfigSchema` at runtime — hench is
 * the execution tier, above the domain packages web depends on — so the two
 * definitions are maintained separately and can drift. When they do, the route
 * answers 200 and writes a file that hench refuses to load, and the next
 * `ndx work` will not start until someone hand-edits it.
 *
 * This test is the thing that catches the drift. It probes each writable field
 * with values on and around hench's refinement boundaries and asserts the
 * one-directional contract: **anything the gate accepts, hench's schema must
 * accept.** The reverse is deliberately not asserted — the gate is allowed to
 * be stricter (it refuses an empty `model`, which `z.string()` would take).
 *
 * The probe runs through `JSON.parse(JSON.stringify(...))` because that is what
 * the routes do: a value that survives the gate but not the serializer (an
 * `Infinity` arriving as JSON `1e999` is written as `null`) is a config hench
 * cannot load, and the round trip is what makes that visible.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

const { CONFIG_FIELD_META, validateFieldValue, setConfigValue } = await import(
  join(ROOT, "packages/web/dist/server/hench-config-fields.js")
);
const { HenchConfigSchema } = await import(
  join(ROOT, "packages/hench/dist/schema/validate.js")
);

/** A config hench accepts, used as the base every probe is applied to. */
function baseConfig() {
  return {
    schema: "hench/v1",
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: ".rex",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
    guard: {
      blockedPaths: [".hench/**", ".rex/**", ".git/**"],
      allowedCommands: ["npm", "git", "tsc"],
      commandTimeout: 30000,
      maxFileSize: 1048576,
    },
    retry: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000 },
  };
}

/**
 * Values to push at a field of each type. They straddle every refinement
 * hench's schema uses on a writable field — `.positive()`, `.nonnegative()`,
 * `.int()`, `z.enum`, `z.array(z.string())` — plus the wrong-type and
 * non-finite shapes that a same-origin caller can send by hand.
 */
const PROBES = {
  number: [0, -0, 1, 2.5, -1, 1e15, Infinity, -Infinity, NaN, "1", null, [1], true, {}],
  string: ["x", ".rex", "", " ", 1, null, ["x"], true, {}],
  enum: ["cli", "api", "codex", "", ["cli"], ["cli", "api"], 1, null, true, { toString: () => "cli" }],
  array: [[], ["a"], ["a", "b"], [1], [null], [["a"]], [{ a: 1 }], "a", 1, null, {}],
  boolean: [true, false, "true", 1, null, []],
};

describe("dashboard hench-config gate agrees with hench's schema", () => {
  it("has a probe set for every declared field type", () => {
    for (const field of CONFIG_FIELD_META) {
      expect(PROBES[field.type], `no probes for type "${field.type}"`).toBeTruthy();
    }
  });

  for (const field of CONFIG_FIELD_META) {
    it(`never accepts a value hench rejects for ${field.path}`, () => {
      let accepted = 0;

      for (const probe of PROBES[field.type]) {
        if (validateFieldValue(field, probe) !== null) continue;
        accepted++;

        const config = baseConfig();
        setConfigValue(config, field.path, probe);
        // Exactly what the routes write, and what hench then reads back.
        const onDisk = JSON.parse(JSON.stringify(config));
        const parsed = HenchConfigSchema.safeParse(onDisk);

        expect(
          parsed.success,
          `the gate accepted ${field.path}=${String(probe)} but hench rejects the ` +
          `resulting config: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
        ).toBe(true);
      }

      // A field whose every probe is refused would pass the loop vacuously and
      // hide a gate that rejects everything.
      expect(accepted, `no probe was accepted for ${field.path}`).toBeGreaterThan(0);
    });
  }

  it("accepts a realistic value for every field at once, and hench loads the result", () => {
    const realistic = {
      provider: "api",
      model: "opus",
      maxTurns: 80,
      maxTokens: 16384,
      tokenBudget: 500000,
      loopPauseMs: 0,
      maxFailedAttempts: 5,
      rexDir: ".rex",
      "retry.maxRetries": 0,
      "retry.baseDelayMs": 1000,
      "retry.maxDelayMs": 60000,
      "guard.blockedPaths": ["dist/**"],
      "guard.allowedCommands": ["pnpm"],
      "guard.commandTimeout": 45000,
      "guard.maxFileSize": 2097152,
      apiKeyEnv: "MY_KEY",
    };

    // Every writable field must be covered, or the assertion below drifts
    // quietly as fields are added.
    expect(Object.keys(realistic).sort()).toEqual(
      CONFIG_FIELD_META.map((f) => f.path).sort(),
    );

    const config = baseConfig();
    for (const [path, value] of Object.entries(realistic)) {
      const field = CONFIG_FIELD_META.find((f) => f.path === path);
      expect(validateFieldValue(field, value), `${path} refused by the gate`).toBeNull();
      setConfigValue(config, path, value);
    }

    const parsed = HenchConfigSchema.safeParse(JSON.parse(JSON.stringify(config)));
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues),
    ).toBe(true);
  });
});
