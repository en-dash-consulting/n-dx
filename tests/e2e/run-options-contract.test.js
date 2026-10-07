/**
 * The dashboard's run-option allow-list (`packages/web/src/shared/run-options.ts`)
 * against the `options` list `ndx work --resolve` prints from hench's own table.
 *
 * Web cannot import hench (hench sits above it), so the table is a copy; this
 * is what keeps it one. A flag added to hench without the dashboard, or to the
 * dashboard without hench, fails here. Two documented differences:
 *
 * - `resetDeferred` is hench's, never the request's: the route adds
 *   `--reset-deferred` itself for a deferred task.
 * - Upper bounds are the dashboard's own policy: hench's flag parser takes any
 *   integer at or above its lower bound (1 for --max-turns, 0 for --token-budget).
 * - `contextNotes` is the dashboard's: its text goes to a temp file passed as
 *   `--context-file`, which is a run input rather than a resolved setting, so
 *   `--resolve` does not list it.
 *
 * `permissionMode` drops `plan`: an autonomous run in plan mode stalls.
 *
 * Rex's `RUN_SETTING_KEYS` (the `run` block saved on a task) is pinned here
 * too, and it is vendor-agnostic: hench's task-scope options with `model`
 * replaced by `tier` + `models` and `reviewModel` by `reviewTier` +
 * `reviewModels`, plus `contextNotes`. The dashboard's `RunOptions` (what one
 * launch sends to execute) keep an explicit model id, because a launch knows
 * its vendor; a saved task may run on any vendor, so it cannot.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTmpDir, removeTmpDir, runResult, setupFullProject } from "./e2e-helpers.js";

const ROOT = join(import.meta.dirname, "../..");
// Source, not dist: a stale build would let the table drift from hench unseen.
// The module is framework-agnostic and imports nothing, so vitest loads it as is.
const { RUN_OPTION_SPECS, runOptionArgs, checkRunOptions } = await import(
  join(ROOT, "packages/web/src/shared/run-options.ts")
);
const { TIER_MODELS, LLM_VENDORS } = await import(join(ROOT, "packages/llm-client/dist/public.js"));
const { RUN_SETTING_KEYS, validateRunSettings } = await import(join(ROOT, "packages/rex/dist/public.js"));

const HENCH_ONLY = new Set(["resetDeferred"]);
const DASHBOARD_ONLY = new Set(["contextNotes"]);
/** Chosen per launch, never saved in a task's `run` block. */
const LAUNCH_ONLY = new Set(["fresh", "allowDirty"]);
/** Launch-time model options and the portable keys a saved block holds instead. */
const SAVED_MODEL_KEYS = { model: ["tier", "models"], reviewModel: ["reviewTier", "reviewModels"] };
const savedKeys = (keys) => keys.flatMap((k) => SAVED_MODEL_KEYS[k] ?? [k]);
const EXCLUDED_VALUES = { permissionMode: ["plan"] };

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("run options contract: dashboard allow-list vs ndx work --resolve", () => {
  let repo;
  let henchOptions;

  beforeAll(async () => {
    repo = await createTmpDir("ndx-run-options-contract-");
    await setupFullProject(repo);
    // Claude offers both providers, so `provider` is not narrowed in the report.
    writeFileSync(
      join(repo, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", claude: { cli_path: process.execPath } } }),
    );
    git(repo, "init", "--quiet", "--initial-branch=main");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");

    const result = runResult(["work", "--task=task-2", "--resolve", repo]);
    expect(result.code, result.stderr).toBe(0);
    henchOptions = JSON.parse(result.stdout).options;
  }, 120_000);

  afterAll(async () => {
    if (repo) await removeTmpDir(repo);
  });

  it("lists the same keys, apart from the documented differences", () => {
    const hench = henchOptions.map((o) => o.key).filter((k) => !HENCH_ONLY.has(k));
    const dashboard = RUN_OPTION_SPECS.map((s) => s.key).filter((k) => !DASHBOARD_ONLY.has(k));
    expect(dashboard).toEqual(hench);
  });

  it("maps each key to hench's flag and type, with hench's enum values", () => {
    const henchByKey = new Map(henchOptions.map((o) => [o.key, o]));
    for (const spec of RUN_OPTION_SPECS.filter((s) => !DASHBOARD_ONLY.has(s.key))) {
      const hench = henchByKey.get(spec.key);
      expect({ key: spec.key, flag: spec.flag, type: spec.type }).toEqual({
        key: hench.key,
        flag: hench.flag,
        type: hench.type,
      });
      if (spec.type === "enum") {
        const excluded = EXCLUDED_VALUES[spec.key] ?? [];
        expect([...spec.values], spec.key).toEqual(hench.values.filter((v) => !excluded.includes(v)));
      }
    }
  });

  it("produces flags ndx work reads as the operator's own", () => {
    const options = {
      model: TIER_MODELS.claude.heavy,
      provider: "cli",
      permissionMode: "acceptEdits",
      review: true,
      reviewModel: TIER_MODELS.claude.standard,
      skipTestGate: true,
      maxTurns: 9,
      tokenBudget: 1000,
      fresh: true,
      allowDirty: true,
    };
    const result = runResult(["work", "--task=task-2", "--resolve", ...runOptionArgs(options), repo]);
    expect(result.code, result.stderr).toBe(0);
    const { resolved } = JSON.parse(result.stdout);
    for (const key of Object.keys(options)) {
      expect({ key, source: resolved[key].source }).toEqual({ key, source: "cli-flag" });
    }
    expect(resolved.maxTurns.value).toBe(9);
    expect(resolved.reviewModel.value).toBe(TIER_MODELS.claude.standard);
  });

  describe("rex's saved run block", () => {
    it("holds hench's task-scope options (model → tier + models, reviewModel → reviewTier + reviewModels) plus contextNotes", () => {
      const taskScope = henchOptions.filter((o) => o.scope === "task").map((o) => o.key);
      expect(taskScope.length).toBeGreaterThan(0);
      expect([...RUN_SETTING_KEYS]).toEqual([...savedKeys(taskScope), "contextNotes"]);
    });

    it("holds the dashboard's options apart from launch-time ones", () => {
      const dashboard = RUN_OPTION_SPECS.map((s) => s.key).filter((k) => !LAUNCH_ONLY.has(k));
      expect([...RUN_SETTING_KEYS]).toEqual(savedKeys(dashboard));
    });

    it("accepts and refuses exactly what the dashboard does at each bound", () => {
      for (const spec of RUN_OPTION_SPECS.filter((s) => !LAUNCH_ONLY.has(s.key) && !(s.key in SAVED_MODEL_KEYS))) {
        const cases = [];
        if (spec.type === "integer") cases.push(spec.min, spec.max, spec.min - 1, spec.max + 1, spec.min + 0.5);
        if (spec.type === "string") cases.push("a".repeat(spec.maxBytes), "a".repeat(spec.maxBytes + 1), 1);
        if (spec.type === "boolean") cases.push(true, false, "true");
        if (spec.type === "enum") cases.push(...spec.values, "plan", "other");
        // The dashboard refuses reviewModel / reviewOptional without review
        // for one launch; a saved block may omit review because config can
        // supply it, so only per-key rules are compared.
        const base = spec.key === "reviewOptional" ? { review: true } : {};
        for (const value of cases) {
          const input = { ...base, [spec.key]: value };
          expect({ key: spec.key, value, ok: validateRunSettings(input).ok }).toEqual({
            key: spec.key,
            value,
            ok: checkRunOptions(input).ok,
          });
        }
      }
    });
  });

  describe("rex's saved model keys", () => {
    it("bound each pinned id like the dashboard's model options and key them by vendor", () => {
      for (const [dashboardKey, [tierKey, modelsKey]] of Object.entries(SAVED_MODEL_KEYS)) {
        const spec = RUN_OPTION_SPECS.find((s) => s.key === dashboardKey);
        expect(spec.type).toBe("string");
        for (const vendor of LLM_VENDORS) {
          expect(validateRunSettings({ [modelsKey]: { [vendor]: "a".repeat(spec.maxBytes) } }).ok).toBe(true);
          expect(validateRunSettings({ [modelsKey]: { [vendor]: "a".repeat(spec.maxBytes + 1) } }).ok).toBe(false);
        }
        expect(validateRunSettings({ [modelsKey]: { notAVendor: "m" } }).ok).toBe(false);
        expect(validateRunSettings({ [dashboardKey]: "m" }).ok, `${dashboardKey} is no longer saved`).toBe(false);
        for (const tier of ["light", "standard", "heavy"]) {
          expect(validateRunSettings({ [tierKey]: tier }).ok).toBe(true);
        }
        expect(validateRunSettings({ [tierKey]: "free" }).ok).toBe(false);
      }
    });
  });

  describe("integer bounds", () => {
    const integers = RUN_OPTION_SPECS.filter((s) => s.type === "integer");

    it("takes each lower bound from hench: it runs with the bound and refuses one below", () => {
      expect(integers.length).toBeGreaterThan(0);
      for (const spec of integers) {
        const at = runResult(["work", "--task=task-2", "--resolve", `--${spec.flag}=${spec.min}`, repo]);
        expect(at.code, `${spec.key} at ${spec.min}: ${at.stderr}`).toBe(0);
        expect(JSON.parse(at.stdout).resolved[spec.key]).toMatchObject({ value: spec.min, source: "cli-flag" });

        const below = runResult(["work", "--task=task-2", "--resolve", `--${spec.flag}=${spec.min - 1}`, repo]);
        expect(below.code, `${spec.key} at ${spec.min - 1} must be refused`).not.toBe(0);

        expect(checkRunOptions({ [spec.key]: spec.min }).ok, `${spec.key} min`).toBe(true);
        expect(checkRunOptions({ [spec.key]: spec.min - 1 }).ok, `${spec.key} below`).toBe(false);
      }
    });

    it("keeps each upper bound where hench reads it back exactly, and refuses one above", () => {
      for (const spec of integers) {
        const at = runResult(["work", "--task=task-2", "--resolve", ...runOptionArgs({ [spec.key]: spec.max }), repo]);
        expect(at.code, `${spec.key} at ${spec.max}: ${at.stderr}`).toBe(0);
        expect(JSON.parse(at.stdout).resolved[spec.key].value, spec.key).toBe(spec.max);

        expect(checkRunOptions({ [spec.key]: spec.max }).ok, `${spec.key} max`).toBe(true);
        expect(checkRunOptions({ [spec.key]: spec.max + 1 }).ok, `${spec.key} above`).toBe(false);
      }
    });
  });
});
