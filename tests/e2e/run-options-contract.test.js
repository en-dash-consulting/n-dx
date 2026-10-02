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
 * - `contextNotes` is the dashboard's: its text goes to a temp file passed as
 *   `--context-file`, which is a run input rather than a resolved setting, so
 *   `--resolve` does not list it.
 *
 * `permissionMode` drops `plan`: an autonomous run in plan mode stalls.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTmpDir, removeTmpDir, runResult, setupFullProject } from "./e2e-helpers.js";

const ROOT = join(import.meta.dirname, "../..");
const { RUN_OPTION_SPECS, runOptionArgs } = await import(join(ROOT, "packages/web/dist/shared/run-options.js"));
const { TIER_MODELS } = await import(join(ROOT, "packages/llm-client/dist/public.js"));

const HENCH_ONLY = new Set(["resetDeferred"]);
const DASHBOARD_ONLY = new Set(["contextNotes"]);
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
});
