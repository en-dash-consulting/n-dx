/**
 * `ndx migrate`'s chain against stubbed spawns: which links run, in what
 * order, with which flags, and where it stops.
 *
 * @see packages/core/migrate-chain.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_MIGRATION_PLAN_OUT, MIGRATION_LINKS, runMigrateChain } from "../../packages/core/migrate-chain.js";

const REX = "/rex.js";

/** Stubs that record each spawn and, by default, succeed. */
function stubs(codes = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      tools: { rex: REX },
      run: async (script, args) => {
        calls.push([script === REX ? "rex" : script, ...args]);
        return codes[args[0]] ?? 0;
      },
      migrateLayout: async (root, flags) => {
        calls.push(["layout", root, ...flags]);
        return codes.layout ?? 0;
      },
    },
  };
}

describe("runMigrateChain", () => {
  let root;
  let log;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ndx-migrate-chain-"));
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.NDX_LEGACY_NOTICE;
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("lists layout, then the folder tree, then schema v2", () => {
    expect(MIGRATION_LINKS.map((l) => `${l.id}: ${l.from} → ${l.to}`)).toEqual([
      "layout: legacy layout → .ndx/ layout",
      "prd-tree: prd.md / prd.json → rex/v1 folder tree",
      "schema-v2: rex/v1 → rex/v2",
    ]);
  });

  it("runs layout, plan and apply on a legacy v1 tree, forwarding each its flags", async () => {
    mkdirSync(join(root, ".rex", "prd_tree"), { recursive: true });
    const { calls, deps } = stubs();
    const code = await runMigrateChain(root, ["--no-commit", "--rules-only", "--model=m", "--out=p.json"], deps);
    expect(code).toBe(0);
    expect(calls).toEqual([
      ["layout", root, "--no-commit"],
      ["rex", "migrate-plan", "--rules-only", "--model=m", "--out=p.json", root],
      ["rex", "migrate-apply", "--plan=p.json", root],
    ]);
    // rex's v1 notice would tell the operator to run the command already running.
    expect(process.env.NDX_LEGACY_NOTICE).toBe("off");
  });

  it("converts a flat prd.json first, and skips layout on .ndx/", async () => {
    mkdirSync(join(root, ".ndx", "rex"), { recursive: true });
    writeFileSync(join(root, ".ndx", "rex", "prd.json"), "{}");
    const { calls, deps } = stubs();
    // The stub writes nothing, so the schema link sees no tree after the conversion.
    await runMigrateChain(root, [], deps);
    expect(calls).toEqual([["rex", "migrate-to-folder-tree", root]]);
  });

  it("does not apply when the plan fails, and returns its code", async () => {
    mkdirSync(join(root, ".ndx", "rex", "prd_tree"), { recursive: true });
    const { calls, deps } = stubs({ "migrate-plan": 3 });
    expect(await runMigrateChain(root, [], deps)).toBe(3);
    expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["rex migrate-plan"]);
  });

  it("forwards --no-jev-review and --cut-at to the plan, and plans to the ndx migrate --plan default", async () => {
    mkdirSync(join(root, ".rex", "prd_tree"), { recursive: true });
    const { calls, deps } = stubs();
    await runMigrateChain(root, ["--no-jev-review", "--cut-at=2026-10-09T00:00:00.000Z"], deps);
    expect(calls.slice(1)).toEqual([
      ["rex", "migrate-plan", "--no-jev-review", "--cut-at=2026-10-09T00:00:00.000Z", `--out=${DEFAULT_MIGRATION_PLAN_OUT}`, root],
      ["rex", "migrate-apply", `--plan=${DEFAULT_MIGRATION_PLAN_OUT}`, root],
    ]);
  });

  it("refuses a flag no link takes, before running anything", async () => {
    mkdirSync(join(root, ".rex", "prd_tree"), { recursive: true });
    const { calls, deps } = stubs();
    expect(await runMigrateChain(root, ["--rule-only"], deps)).toBe(1);
    expect(calls).toEqual([]);
  });

  it("stops at the first failing link", async () => {
    mkdirSync(join(root, ".rex", "prd_tree"), { recursive: true });
    const { calls, deps } = stubs({ layout: 1 });
    expect(await runMigrateChain(root, [], deps)).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("--dry-run rehearses layout and schema", async () => {
    mkdirSync(join(root, ".rex", "prd_tree"), { recursive: true });
    const { calls, deps } = stubs();
    await runMigrateChain(root, ["--dry-run"], deps);
    expect(calls).toEqual([
      ["layout", root, "--dry-run"],
      ["rex", "migrate-plan", "--rules-only", `--out=${DEFAULT_MIGRATION_PLAN_OUT}`, root],
      ["rex", "migrate-apply", `--plan=${DEFAULT_MIGRATION_PLAN_OUT}`, "--dry-run", root],
    ]);
  });

  it("--dry-run runs the model passes only with --with-models, which rex never sees", async () => {
    mkdirSync(join(root, ".rex", "prd_tree"), { recursive: true });
    const { calls, deps } = stubs();
    await runMigrateChain(root, ["--dry-run", "--with-models"], deps);
    expect(calls.find((c) => c[1] === "migrate-plan")).toEqual([
      "rex",
      "migrate-plan",
      `--out=${DEFAULT_MIGRATION_PLAN_OUT}`,
      root,
    ]);
  });

  it("a real run keeps the model passes on", async () => {
    mkdirSync(join(root, ".rex", "prd_tree"), { recursive: true });
    const { calls, deps } = stubs();
    await runMigrateChain(root, [], deps);
    expect(calls.find((c) => c[1] === "migrate-plan")).not.toContain("--rules-only");
  });

  it("--dry-run stops before the folder-tree conversion, which cannot rehearse", async () => {
    mkdirSync(join(root, ".ndx", "rex"), { recursive: true });
    writeFileSync(join(root, ".ndx", "rex", "prd.md"), "# PRD\n");
    const { calls, deps } = stubs();
    expect(await runMigrateChain(root, ["--dry-run"], deps)).toBe(0);
    expect(calls).toEqual([]);
    expect(log.mock.calls.flat().join("\n")).toContain("--dry-run stops here");
  });

  it("does nothing on a v2 project on .ndx/", async () => {
    mkdirSync(join(root, ".ndx", "rex", "product"), { recursive: true });
    const { calls, deps } = stubs();
    expect(await runMigrateChain(root, [], deps)).toBe(0);
    expect(calls).toEqual([]);
    expect(log.mock.calls.flat().join("\n")).toContain("Nothing to migrate");
  });
});
