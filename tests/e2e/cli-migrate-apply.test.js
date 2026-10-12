/**
 * `ndx migrate --apply` through the real CLI: it spawns `rex migrate --apply`
 * with the same flags (a space-separated `--plan <path>` rewritten to the `=`
 * form) and forwards rex's exit code; `--dry-run` reports per v1 kind and
 * writes nothing.
 *
 * @see packages/core/cli.js handleMigrate
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
    const plan = join(dir, ".ndx-migration", "plan.json");
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

  it("still needs --plan or --apply", () => {
    const result = runResult(["migrate", dir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("needs --plan or --apply");
  });
});
