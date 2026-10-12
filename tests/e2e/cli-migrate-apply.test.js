/**
 * `ndx migrate --apply` through the real CLI: it spawns `rex migrate --apply`
 * with the same flags (a space-separated `--plan <path>` rewritten to the `=`
 * form) and forwards rex's exit code; `--dry-run` reports per v1 kind and
 * writes nothing.
 *
 * @see packages/core/cli.js handleMigrate
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { createTmpDir, removeTmpDir, run, runResult, setupHenchDir, setupRexDir, setupSourcevisionDir } from "./e2e-helpers.js";

/** Every file under `dir` with its bytes, so "writes nothing" is a comparison. */
function snapshot(dir) {
  const out = {};
  const visit = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) visit(p);
      else out[p.slice(dir.length)] = readFileSync(p, "utf-8");
    }
  };
  visit(dir);
  return out;
}

describe("ndx migrate --apply", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTmpDir("ndx-e2e-migrate-apply-");
    await setupRexDir(dir);
    await setupHenchDir(dir);
    await setupSourcevisionDir(dir);
    run(["rex", "migrate-to-folder-tree", dir]);
    run(["migrate", "--plan", "--rules-only", dir]);
  });

  afterEach(async () => {
    await removeTmpDir(dir);
  });

  it("--dry-run prints per kind what becomes what, the Inbox holds and the dropped values, and writes nothing", () => {
    const before = snapshot(dir);
    const out = run(["migrate", "--apply", "--dry-run", dir]);

    expect(out).toContain("Nothing was written");
    expect(out).toMatch(/epic \(1\): 1 area; held for the Inbox 0; dropped 0 droppedMeta, 0 droppedLog/);
    expect(out).toMatch(/task \(2\): .*held for the Inbox \d+; dropped 0 droppedMeta, 0 droppedLog/);
    expect(out).toContain("Total (3)");
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(join(dir, ".rex", "prd_tree"))).toBe(true);
    expect(existsSync(join(dir, ".rex", "product"))).toBe(false);
  });

  it("rewrites --plan <path> to --plan=<path> and applies that plan", () => {
    // Away from the default path, so a bare --plan (the path dropped) would find no plan.
    const plan = join(dir, "elsewhere.json");
    renameSync(join(dir, ".ndx-migration", "plan.json"), plan);
    const out = run(["migrate", "--apply", "--plan", plan, "--dry-run", dir]);
    expect(out).toContain("apply would migrate 3 v1 items");
  });

  it("forwards rex's exit code and message when the plan is missing", () => {
    const missing = join(dir, "nowhere.json");
    const result = runResult(["migrate", "--apply", "--plan", missing, dir]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`No migration plan at ${missing}`);
    expect(existsSync(join(dir, ".rex", "prd_tree"))).toBe(true);
  });

  it("without --dry-run writes the v2 tree and removes the v1 tree", () => {
    run(["migrate", "--apply", dir]);
    expect(existsSync(join(dir, ".rex", "product"))).toBe(true);
    expect(existsSync(join(dir, ".rex", "prd_tree"))).toBe(false);
  });

  it("refuses, exits non-zero and writes nothing while .rex/prd.json sits beside the tree", () => {
    const prdJson = join(dir, ".rex", "prd.json");
    expect(existsSync(prdJson)).toBe(false);
    renameSync(`${prdJson}.migrated`, prdJson);
    const before = snapshot(dir);

    const result = runResult(["migrate", "--apply", dir]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`Legacy PRD source beside the tree: ${prdJson}`);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe("ndx migrate (the chain)", () => {
  let dir;

  beforeEach(async () => {
    // Legacy on both counts: state at the root (.rex/, .hench/, …) and the PRD in prd.json.
    dir = await createTmpDir("ndx-e2e-migrate-chain-");
    await setupRexDir(dir);
    await setupHenchDir(dir);
    await setupSourcevisionDir(dir);
  });

  afterEach(async () => {
    await removeTmpDir(dir);
  });

  it("migrates a legacy fixture to .ndx/ and v2 with one command", () => {
    const result = runResult(["migrate", "--rules-only", dir]);
    const out = result.stdout;

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).not.toContain("Deprecated:");
    expect(out).toContain("[1/3] layout");
    expect(out).toContain("Migrated 3 v1 items to the v2 layout");
    expect(existsSync(join(dir, ".rex"))).toBe(false);
    expect(existsSync(join(dir, ".ndx", "rex", "product", "index.md"))).toBe(true);
    expect(existsSync(join(dir, ".ndx", "rex", "prd_tree"))).toBe(false);
  });

  it("--dry-run moves nothing and stops before the folder-tree conversion", () => {
    const before = snapshot(dir);
    const out = run(["migrate", "--dry-run", "--rules-only", dir]);
    expect(out).toContain("--dry-run stops here");
    expect(snapshot(dir)).toEqual(before);
  });

  it("re-run on a migrated project does nothing", () => {
    run(["migrate", "--rules-only", dir]);
    expect(run(["migrate", dir])).toContain("Nothing to migrate");
  });
});
