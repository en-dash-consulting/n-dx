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

const {
  CONFIG_FIELD_META,
  CONFIG_GROUP_DEFAULTS,
  MIN_PRUNE_PAIRS: WEB_MIN_PRUNE_PAIRS,
  completeConfigGroups,
  validateFieldValue,
  validateConfigConstraints,
  getConfigValue,
  setConfigValue,
} = await import(join(ROOT, "packages/web/dist/server/hench-config-fields.js"));
const { HenchConfigSchema } = await import(
  join(ROOT, "packages/hench/dist/schema/validate.js")
);
const { DEFAULT_HENCH_CONFIG, MIN_PRUNE_PAIRS } = await import(
  join(ROOT, "packages/hench/dist/schema/v1.js")
);
const { CONFIG_FIELDS } = await import(
  join(ROOT, "packages/hench/dist/cli/commands/config.js")
);
const { HELP_TEXT } = await import(join(ROOT, "packages/core/config.js"));

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
  // 3 and 50 are the two mid-range values: without them the bounded fields
  // (`prune.retainPairs` needs ≥2 and below the trigger, the memory thresholds
  // need 0–100) would have every probe refused, and the "no probe was accepted"
  // guard below would fire on a gate that is in fact correct.
  number: [0, -0, 1, 2.5, 3, 50, -1, 1e15, Infinity, -Infinity, NaN, "1", null, [1], true, {}],
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

      // An enum field's own members go in front of the hostile set: the shared
      // enum probes are all drawn from `provider`, so a field like
      // `promptCacheTtl` would have every probe refused and trip the
      // "no probe was accepted" guard below on a gate that is working.
      const probes =
        field.type === "enum" ? [...field.enumValues, ...PROBES.enum] : PROBES[field.type];

      for (const probe of probes) {
        if (validateFieldValue(field, probe) !== null) continue;

        const config = baseConfig();
        setConfigValue(config, field.path, probe);
        // The routes' gate is the composition of three steps, not just the
        // per-field check: complete the group, then apply the sibling
        // constraints that only the finished config can decide.
        completeConfigGroups(config);
        if (validateConfigConstraints(config) !== null) continue;
        accepted++;

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
      permissionMode: "acceptEdits",
      autonomous: true,
      maxSpawnsPerTask: 12,
      livelockThreshold: 0,
      promptCache: false,
      promptCacheTtl: "1h",
      useEventPipeline: true,
      useRegistryProvider: false,
      sessionStrategy: "batch",
      tasksPerSession: 6,
      parentMaxAgeHours: 12,
      maxFailedAttempts: 5,
      rexDir: ".rex",
      "retry.maxRetries": 0,
      "retry.baseDelayMs": 1000,
      "retry.maxDelayMs": 60000,
      "prune.triggerPairs": 30,
      "prune.retainPairs": 12,
      "prune.transcriptMessageChars": 4000,
      fullTestCommand: "pnpm test",
      fullTestTimeoutMs: 0,
      rollbackOnFailure: false,
      autoCommit: true,
      commitMsgTimeoutMs: 0,
      "git.checkpointThreshold": 0,
      "git.requireCleanTree": true,
      "guard.blockedPaths": ["dist/**"],
      "guard.allowedCommands": ["pnpm"],
      "guard.commandTimeout": 45000,
      "guard.maxFileSize": 2097152,
      "guard.maxConcurrentProcesses": 2,
      "guard.allowedGitSubcommands": ["status", "diff"],
      "guard.memoryThrottle.enabled": true,
      "guard.memoryThrottle.rejectThreshold": 90,
      "guard.memoryThrottle.delayThreshold": 70,
      "guard.memoryThrottle.baseDelayMs": 5000,
      "guard.memoryThrottle.maxDelayMs": 60000,
      "guard.memoryThrottle.maxRetries": 0,
      "guard.memoryMonitor.enabled": true,
      "guard.memoryMonitor.spawnThreshold": 85,
      "guard.spawnTimeout": 0,
      "guard.policy.maxCommandsPerMinute": 30,
      "guard.policy.maxWritesPerMinute": 60,
      "guard.policy.maxTotalBytesWritten": 10485760,
      "guard.policy.maxTotalCommands": 500,
      apiKeyEnv: "MY_KEY",
      claudePath: "/usr/local/bin/claude",
      language: "swift",
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

  describe("nested group completion", () => {
    // The drift this pins: web's CONFIG_GROUP_DEFAULTS mirrors hench's
    // DEFAULT_HENCH_CONFIG() because web cannot import hench at runtime. If
    // hench changes a default, the dashboard would silently write stale values
    // into completed groups.
    it("web's group defaults equal hench's config defaults", () => {
      const henchDefaults = DEFAULT_HENCH_CONFIG();
      for (const group of Object.keys(CONFIG_GROUP_DEFAULTS)) {
        expect(CONFIG_GROUP_DEFAULTS[group], `group "${group}"`).toEqual(henchDefaults[group]);
      }
      // Iterating web's keys alone would pass vacuously if the mirror lost a
      // group, so name the ones that must be there.
      expect(Object.keys(CONFIG_GROUP_DEFAULTS).sort()).toEqual(["prune", "retry"]);
    });

    // A group completed from web's mirror must satisfy hench's cross-field
    // refinements, not just its per-field types.
    it("a config completed from web's mirror alone still loads", () => {
      for (const group of Object.keys(CONFIG_GROUP_DEFAULTS)) {
        const config = baseConfig();
        config[group] = {};
        completeConfigGroups(config);

        const parsed = HenchConfigSchema.safeParse(JSON.parse(JSON.stringify(config)));
        expect(
          parsed.success,
          `an empty "${group}" completed from web's defaults leaves a config hench rejects: ` +
          (parsed.success ? "" : JSON.stringify(parsed.error.issues)),
        ).toBe(true);
      }
    });

    // The regression this pins: writing one retry.* key into a config with no
    // retry block used to leave a one-member group on disk that hench refused,
    // and `ndx work` failed with NDX_CLI_INVALID_CONFIGURATION until the file
    // was hand-edited. Every dashboard write path now runs
    // completeConfigGroups before serializing.
    it("a single group-member write into a config without the group still loads", () => {
      for (const field of CONFIG_FIELD_META) {
        const [group] = field.path.split(".");
        if (!(group in CONFIG_GROUP_DEFAULTS) || !field.path.includes(".")) continue;

        const config = baseConfig();
        delete config[group];
        setConfigValue(config, field.path, CONFIG_GROUP_DEFAULTS[group][field.path.split(".")[1]]);
        completeConfigGroups(config);

        const parsed = HenchConfigSchema.safeParse(JSON.parse(JSON.stringify(config)));
        expect(
          parsed.success,
          `${field.path} written alone leaves a config hench rejects: ` +
          (parsed.success ? "" : JSON.stringify(parsed.error.issues)),
        ).toBe(true);
      }
    });
  });
});

/**
 * The three curated lists of hench settings, and the rule that they are one list.
 *
 * `ndx config --help` documents what `ndx config hench.<key>` accepts, `hench
 * config` offers its own curated menu, and the dashboard renders a third from
 * `CONFIG_FIELD_META`. All three were maintained by hand and had drifted: the
 * CLI menu was missing sixteen documented keys (`promptCacheTtl`, the whole
 * `prune` and test-gate groups, the git-safety pair, session reuse), and the
 * dashboard was missing those plus the guard keys the CLI already had —
 * `guard.memoryMonitor.spawnThreshold` among them, which `memory-monitor.ts`
 * tells the operator to set with a `hench config` command that then refused the
 * key.
 *
 * hench's `CONFIG_FIELDS` is the source: it sits in the package that owns the
 * schema. The other two mirror it, because neither can import it — web sits
 * below hench in the tier order, and orchestration scripts import no package at
 * all.
 */
describe("hench, the dashboard and ndx config offer the same settings", () => {
  const henchPaths = CONFIG_FIELDS.map((f) => f.path).sort();
  const webPaths = CONFIG_FIELD_META.map((f) => f.path).sort();

  /**
   * Setting rows in the help text: two-space indent, then the key. Prose
   * continuation lines are indented further and the `Examples` section starts
   * each line with the command, so neither is picked up.
   */
  const documentedPaths = [
    ...new Set(
      Array.from(HELP_TEXT.matchAll(/^ {2}hench\.([A-Za-z][A-Za-z0-9.]*)/gm), (m) => m[1]),
    ),
  ].sort();

  it("hench config and the dashboard list the same keys", () => {
    expect(webPaths).toEqual(henchPaths);
  });

  it("every key ndx config documents for hench is on both lists", () => {
    expect(documentedPaths.filter((p) => !henchPaths.includes(p))).toEqual([]);
    expect(documentedPaths.filter((p) => !webPaths.includes(p))).toEqual([]);
  });

  it("every key the two lists offer is documented by ndx config", () => {
    expect(henchPaths.filter((p) => !documentedPaths.includes(p))).toEqual([]);
  });

  // A path neither list can explain is worse than a missing one: the menu
  // offers a setting, the write succeeds, and hench drops it on load (zod
  // strips unknown keys), so the operator sees a value that does nothing.
  it("every listed key is a key hench's schema keeps", () => {
    const config = baseConfig();
    for (const field of CONFIG_FIELD_META) {
      setConfigValue(config, field.path, sampleValue(field));
    }
    completeConfigGroups(config);
    expect(validateConfigConstraints(config)).toBeNull();

    const parsed = HenchConfigSchema.safeParse(JSON.parse(JSON.stringify(config)));
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);

    for (const field of CONFIG_FIELD_META) {
      expect(
        getConfigValue(parsed.data, field.path),
        `hench's schema dropped "${field.path}" — the lists offer a key it does not define`,
      ).toEqual(sampleValue(field));
    }
  });

  it("the two lists agree on type and enum values for every key", () => {
    for (const web of CONFIG_FIELD_META) {
      const cli = CONFIG_FIELDS.find((f) => f.path === web.path);
      expect(cli, `${web.path} missing from hench's CONFIG_FIELDS`).toBeTruthy();
      expect(cli.type, `${web.path} type`).toBe(web.type);
      expect(cli.enumValues ?? null, `${web.path} enum values`).toEqual(web.enumValues ?? null);
    }
  });

  // web mirrors hench's floor rather than importing it.
  it("web's prune floor equals hench's", () => {
    expect(WEB_MIN_PRUNE_PAIRS).toBe(MIN_PRUNE_PAIRS);
  });

  /**
   * The dashboard's "differs from default" marker reads `defaultValue` off each
   * row. A stale copy shows an untouched config as modified, so pin every row
   * against what hench actually applies to a config that omits the key.
   *
   * `guard.blockedPaths` and `guard.allowedCommands` are exempt in one
   * direction: their defaults are chosen by project language, so there is no
   * single value to record and the rows deliberately carry none.
   */
  describe("recorded defaults", () => {
    const LANGUAGE_DEPENDENT = ["guard.blockedPaths", "guard.allowedCommands"];
    const applied = HenchConfigSchema.parse(DEFAULT_HENCH_CONFIG());

    it("match what hench applies when the key is absent", () => {
      for (const field of CONFIG_FIELD_META) {
        if (field.defaultValue === undefined) continue;
        expect(field.defaultValue, `${field.path} default`).toEqual(
          getConfigValue(applied, field.path),
        );
      }
    });

    it("are recorded for every key hench defaults", () => {
      for (const field of CONFIG_FIELD_META) {
        if (LANGUAGE_DEPENDENT.includes(field.path)) continue;
        const henchDefault = getConfigValue(applied, field.path);
        if (henchDefault === undefined) continue;
        expect(
          field.defaultValue,
          `hench defaults ${field.path} to ${JSON.stringify(henchDefault)} but the row records none`,
        ).not.toBeUndefined();
      }
    });
  });
});

/**
 * The one pair whose valid range is set by a sibling rather than a constant:
 * hench refuses a config whose retained turn-pairs reach its prune trigger.
 */
const SAMPLE_OVERRIDES = {
  "prune.triggerPairs": 50,
  "prune.retainPairs": 5,
};

/**
 * A value the gate accepts for `field`, chosen from its own declared
 * refinements so the sample is valid by construction rather than by a table
 * that would need updating with every new key.
 */
function sampleValue(field) {
  if (field.path in SAMPLE_OVERRIDES) return SAMPLE_OVERRIDES[field.path];
  switch (field.type) {
    case "string":
      return "x";
    case "boolean":
      return true;
    case "array":
      return ["x"];
    case "enum":
      return field.enumValues[0];
    case "number": {
      // Mid-range: above every floor in use, below the 0–100 ceilings, and
      // clear of the prune pair's ordering rule once the group is completed.
      const candidate = field.max !== undefined ? Math.min(50, field.max) : 50;
      return Math.max(candidate, field.min ?? 1, field.positive ? 1 : 0);
    }
    default:
      throw new Error(`no sample value for type "${field.type}"`);
  }
}
