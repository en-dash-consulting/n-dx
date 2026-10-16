/**
 * Tests for `rex migrate-apply`: a plan written by `rex migrate-plan` applied
 * through the command, re-applied as a no-op, rehearsed without writing, and
 * refused without a plan.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdMigrateApply } from "../../../../src/cli/commands/migrate-apply.js";
import { cmdMigratePlan } from "../../../../src/cli/commands/migrate-plan.js";
import { CLIError } from "../../../../src/cli/errors.js";
import type { PRDItem } from "../../../../src/schema/v1.js";
import { FileStore } from "../../../../src/store/index.js";
import { loadPrdModel } from "../../../../src/store/prd-model-reader.js";

const item = (id: string, level: PRDItem["level"], title: string, children: PRDItem[] = [], extra: Partial<PRDItem> = {}): PRDItem => ({
  id,
  level,
  title,
  status: "completed",
  children,
  ...extra,
});

const TREE: PRDItem[] = [
  item("e1", "epic", "Storage", [
    item("f1", "feature", "Offline cache", [item("t1", "task", "Write the cache")], { description: "Pages stay readable offline." }),
    item("f2", "feature", "Cache eviction", [item("t2", "task", "Evict entries", [], { status: "pending" })], { status: "pending" }),
  ]),
];

/** Every file under `dir` with its bytes, so "writes nothing" is a comparison. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) visit(p);
      else out[p.slice(dir.length)] = readFileSync(p, "utf8");
    }
  };
  visit(dir);
  return out;
}

describe("cmdMigrateApply", () => {
  let repo: string;
  let rexDir: string;
  let planPath: string;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rex-migrate-apply-cmd-")));
    rexDir = join(repo, ".rex");
    mkdirSync(rexDir);
    writeFileSync(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
    await new FileStore(rexDir).saveDocument({ schema: "rex/v1", title: "Shop", items: TREE });
    planPath = join(repo, "migration-plan.json");
    await cmdMigratePlan(repo, { "rules-only": "true", out: planPath, "cut-at": "2026-10-12T00:00:00.000Z" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(repo, { recursive: true, force: true });
  });

  it("applies the plan migrate-plan wrote, and a second apply is a no-op", async () => {
    await cmdMigrateApply(repo, { plan: planPath });
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
    const model = await loadPrdModel(rexDir);
    expect(model).toMatchObject({ layout: "v2", title: "Shop" });
    expect(model.warnings).toEqual([]);

    const after = snapshot(rexDir);
    await cmdMigrateApply(repo, { plan: planPath });
    expect(snapshot(rexDir)).toEqual(after);
    // On a v2 tree the plan is not needed.
    await cmdMigrateApply(repo, {});
    expect(snapshot(rexDir)).toEqual(after);
  });

  it("--dry-run writes nothing", async () => {
    const before = snapshot(repo);
    await cmdMigrateApply(repo, { plan: planPath, "dry-run": "true" });
    expect(snapshot(repo)).toEqual(before);
  });

  it("refuses a v1 tree without --plan and writes nothing", async () => {
    const before = snapshot(repo);
    for (const flags of [{}, { plan: "true" }]) {
      const err = await cmdMigrateApply(repo, flags).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).message).toBe("Missing --plan path.");
    }
    expect(snapshot(repo)).toEqual(before);
  });

  it("refuses a --plan that names no file and writes nothing", async () => {
    const before = snapshot(repo);
    const missing = join(repo, "nowhere.json");
    await expect(cmdMigrateApply(repo, { plan: missing })).rejects.toThrow(`No migration plan at ${missing}.`);
    expect(snapshot(repo)).toEqual(before);
  });
});
