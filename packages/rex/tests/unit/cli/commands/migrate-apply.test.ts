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

  describe("a prd_tree/ left beside the v2 tree", () => {
    const NEW_EPIC = "11111111-1111-4111-8111-111111111111";

    /** Apply, then put back a v1 tree of `items` beside the v2 tree. */
    async function leftover(items: PRDItem[]): Promise<void> {
      await cmdMigrateApply(repo, { plan: planPath });
      const scratch = join(repo, "scratch-rex");
      mkdirSync(scratch);
      await new FileStore(scratch).saveDocument({ schema: "rex/v1", title: "Shop", items });
      for (const [path, text] of Object.entries(snapshot(scratch))) {
        if (!path.startsWith("/prd_tree") && path !== "/tree-meta.json") continue;
        mkdirSync(join(rexDir, path, ".."), { recursive: true });
        writeFileSync(join(rexDir, path), text);
      }
      rmSync(scratch, { recursive: true });
    }

    const printed = (): string => vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");

    it("--dry-run says apply would remove what an interrupted apply left, and why", async () => {
      await leftover(TREE);
      await cmdMigrateApply(repo, { plan: planPath, "dry-run": "true" });
      expect(printed()).toMatch(/Apply would remove what an interrupted apply left \(it matches the plan's source\)/);
      expect(existsSync(join(rexDir, "prd_tree"))).toBe(true);
    });

    it.each([
      ["with the plan", true],
      ["without a plan", false],
    ])("--dry-run and apply refuse one holding an item the v2 tree lacks, %s", async (_label, withPlan) => {
      await leftover([...TREE, item(NEW_EPIC, "epic", "Billing", [], { status: "pending" })]);
      const flags: Record<string, string> = withPlan ? { plan: planPath } : {};
      for (const extra of [{ "dry-run": "true" }, {}]) {
        const err = await cmdMigrateApply(repo, { ...flags, ...extra }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).message).toContain(NEW_EPIC);
      }
      expect(existsSync(join(rexDir, "prd_tree"))).toBe(true);
    });
  });

  it("--dry-run writes nothing", async () => {
    const before = snapshot(repo);
    await cmdMigrateApply(repo, { plan: planPath, "dry-run": "true" });
    expect(snapshot(repo)).toEqual(before);
  });

  it("--dry-run lists every blockedBy rewrite and drop with the old and new refs", async () => {
    const items: PRDItem[] = [
      item("e1", "epic", "Storage", [
        item("f1", "feature", "Offline cache", [item("t1", "task", "Write the cache")]),
        item("f2", "feature", "Cache eviction", [
          item("t3", "task", "Size the cache"),
          item("t2", "task", "Evict entries", [], { status: "pending" }),
        ], { status: "pending" }),
        item("f3", "feature", "Cache metrics", [
          item("t4", "task", "Add a counter"),
          item("t5", "task", "Count hits", [], { status: "pending", blockedBy: ["f2", "f1", "r1"] }),
        ], { status: "pending", blockedBy: ["f2"] }),
      ]),
      item("r1", "epic", "ndx 0.9.0", [item("f9", "feature", "Tune writes", [], { status: "pending" })], { status: "pending" }),
    ];
    await new FileStore(rexDir).saveDocument({ schema: "rex/v1", title: "Shop", items });
    await cmdMigratePlan(repo, { "rules-only": "true", out: planPath, "cut-at": "2026-10-12T00:00:00.000Z" });
    vi.mocked(console.log).mockClear();

    await cmdMigrateApply(repo, { plan: planPath, "dry-run": "true" });
    const lines = vi.mocked(console.log).mock.calls.map((c) => c.join(" ").trim());
    expect(lines).toEqual(
      expect.arrayContaining([
        "t5: blockedBy r1 → f9",
        "t5: blockedBy f2 → t2",
        "t5: blockedBy f1 → dropped (no open change: met)",
        "f3: blockedBy f2 → t2, moved onto its open changes t5",
      ]),
    );
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
