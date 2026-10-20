/**
 * The incremental inventory cache is tied to the rules that made it: an
 * incremental run reuses an entry only when the sourcevision version and the
 * merged language config are the ones its inventory was made under. The
 * fingerprint lives in the machine-local cache, never in inventory.json.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runInventoryPhase, type AnalyzeContext } from "../../src/cli/commands/analyze-phases.js";
import { cmdInit } from "../../src/cli/commands/init.js";
import { emptyAnalyzeTokenUsage } from "../../src/cli/sourcevision-core.js";
import { analyzeInventory, inventoryFingerprint } from "../../src/analyzers/inventory.js";
import { detectLanguages, mergeLanguageConfigs } from "../../src/language/detect.js";
import { resolveSourcevisionPaths } from "../../src/paths.js";
import type { Inventory } from "../../src/schema/v1.js";
import { toCanonicalJSON } from "../../src/util/sort.js";

const FILES: Record<string, string> = {
  "package.json": "{}",
  "src/app.ts": "export const app = 1;\n",
  "svc/store_test.go": "package svc\n",
};

describe("inventory cache fingerprint", () => {
  let project: string | null = null;
  afterEach(() => {
    if (project) rmSync(project, { recursive: true, force: true });
    project = null;
    vi.restoreAllMocks();
  });

  function setup(): AnalyzeContext {
    project = mkdtempSync(join(tmpdir(), "sv-inventory-fingerprint-"));
    for (const [rel, body] of Object.entries(FILES)) {
      mkdirSync(dirname(join(project, rel)), { recursive: true });
      writeFileSync(join(project, rel), body);
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    cmdInit(project);
    return {
      absDir: project,
      svDir: resolveSourcevisionPaths(project).svDir,
      fullMode: false,
      fastMode: true,
      narrate: false,
      wait: false,
      tokenUsage: emptyAnalyzeTokenUsage(),
      inventoryResult: null,
    };
  }

  const inventoryPath = (run: AnalyzeContext) => join(run.svDir, "inventory.json");
  const fingerprintPath = (run: AnalyzeContext) => join(resolveSourcevisionPaths(run.absDir).cacheDir, "inventory-fingerprint.json");
  const roleOf = (run: AnalyzeContext, path: string) =>
    (JSON.parse(readFileSync(inventoryPath(run), "utf-8")) as Inventory).files.find((f) => f.path === path)?.role;

  /** Rewrite one cached entry's role, as an older classifier would have left it. */
  function staleRole(run: AnalyzeContext, path: string, role: string): void {
    const inv = JSON.parse(readFileSync(inventoryPath(run), "utf-8")) as Inventory;
    inv.files = inv.files.map((f) => (f.path === path ? { ...f, role: role as typeof f.role } : f));
    writeFileSync(inventoryPath(run), toCanonicalJSON(inv));
  }

  it("reuses every cached entry when the rules are unchanged", async () => {
    const run = setup();
    await runInventoryPhase(run);
    staleRole(run, "src/app.ts", "test");

    await runInventoryPhase(run);

    expect(run.inventoryResult?.stats).toMatchObject({ cached: 2, changed: 0, added: 0, touched: 0 });
    // The entry came from the cache, not the file.
    expect(roleOf(run, "src/app.ts")).toBe("test");
  }, 60_000);

  it("reclassifies unchanged files after a language config change", async () => {
    const run = setup();
    await runInventoryPhase(run);
    expect(roleOf(run, "svc/store_test.go")).toBe("source");

    // go.mod (not inventoried itself) brings in Go's rules: *_test.go is a test.
    writeFileSync(join(project!, "go.mod"), "module example.com/x\n");
    await runInventoryPhase(run);

    expect(roleOf(run, "svc/store_test.go")).toBe("test");
  }, 60_000);

  it("ignores a previous inventory whose fingerprint differs or is missing", async () => {
    const run = setup();
    await runInventoryPhase(run);

    staleRole(run, "src/app.ts", "test");
    writeFileSync(fingerprintPath(run), JSON.stringify({ fingerprint: "another-version" }));
    await runInventoryPhase(run);
    expect(roleOf(run, "src/app.ts")).toBe("source");

    staleRole(run, "src/app.ts", "test");
    rmSync(fingerprintPath(run));
    await runInventoryPhase(run);
    expect(roleOf(run, "src/app.ts")).toBe("source");
  }, 60_000);

  it("changes the fingerprint with the sourcevision version", async () => {
    const config = mergeLanguageConfigs(await detectLanguages(mkdtempSync(join(tmpdir(), "sv-fp-empty-"))));
    expect(inventoryFingerprint(config, "1.0.0")).toBe(inventoryFingerprint(config, "1.0.0"));
    expect(inventoryFingerprint(config, "1.0.0")).not.toBe(inventoryFingerprint(config, "1.0.1"));
  });

  it("keeps the fingerprint out of inventory.json", async () => {
    const run = setup();
    await runInventoryPhase({ ...run, fullMode: true });

    const written = readFileSync(inventoryPath(run), "utf-8");
    const direct = await analyzeInventory(run.absDir, {
      languageConfig: mergeLanguageConfigs(await detectLanguages(run.absDir)),
    });
    expect(written).toBe(toCanonicalJSON({ files: direct.files, summary: direct.summary }));
    expect(written).not.toContain("fingerprint");
    expect(existsSync(fingerprintPath(run))).toBe(true);
  }, 60_000);
});
