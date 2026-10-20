/**
 * inventory.json's analysedLanguages follows the Python pack on an
 * imports-only re-run (`sv analyze --phase=2`): a Python entry left by a run
 * with the pack is removed once the pack is gone, and without the pack the
 * imports phase does not rewrite inventory.json. The missing pack is
 * simulated at the loader, as in terraform-listed-pack-notice.test.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runImportsPhase, runInventoryPhase, type AnalyzeContext } from "../../src/cli/commands/analyze-phases.js";
import { cmdInit } from "../../src/cli/commands/init.js";
import { emptyAnalyzeTokenUsage } from "../../src/cli/sourcevision-core.js";
import { resolveSourcevisionPaths } from "../../src/paths.js";
import type { Inventory } from "../../src/schema/v1.js";
import { toCanonicalJSON } from "../../src/util/sort.js";

vi.mock("../../src/language/pack-loader.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/language/pack-loader.js")>();
  const notInstalled = () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-python' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" }));
  const missing = (pack: { id: string }) => ({ ...pack, importByResolution: notInstalled });
  return {
    ...original,
    KNOWN_PACKS: original.KNOWN_PACKS.map((pack) => (pack.id === "python" ? missing(pack) : pack)),
    INSTALLABLE_PACKS: original.INSTALLABLE_PACKS.map((pack) => (pack.id === "python" ? missing(pack) : pack)),
  };
});

const FILES: Record<string, string> = {
  "pyproject.toml": '[project]\nname = "shop"\n',
  "package.json": "{}",
  "shop/__init__.py": "from .orders import place\n",
  "shop/orders.py": "def place():\n    pass\n",
  "web/app.ts": 'import { api } from "./api";\nexport const app = api;\n',
  "web/api.ts": "export const api = 1;\n",
};

describe("imports phase with the Python pack missing", () => {
  let project: string | null = null;
  afterEach(() => {
    if (project) rmSync(project, { recursive: true, force: true });
    project = null;
    vi.restoreAllMocks();
  });

  async function phaseOne(): Promise<{ run: AnalyzeContext; inventoryPath: string }> {
    project = mkdtempSync(join(tmpdir(), "sv-python-rerun-"));
    for (const [rel, body] of Object.entries(FILES)) {
      mkdirSync(dirname(join(project, rel)), { recursive: true });
      writeFileSync(join(project, rel), body);
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
    cmdInit(project);
    const run: AnalyzeContext = {
      absDir: project,
      svDir: resolveSourcevisionPaths(project).svDir,
      fullMode: true,
      fastMode: true,
      narrate: false,
      wait: false,
      tokenUsage: emptyAnalyzeTokenUsage(),
      inventoryResult: null,
    };
    await runInventoryPhase(run);
    return { run, inventoryPath: join(run.svDir, "inventory.json") };
  }

  it("does not rewrite inventory.json after a fresh inventory", async () => {
    const { run, inventoryPath } = await phaseOne();
    const before = readFileSync(inventoryPath, "utf-8");
    expect((JSON.parse(before) as Inventory).summary.analysedLanguages).toEqual(["TypeScript"]);
    await runImportsPhase(run);
    expect(readFileSync(inventoryPath, "utf-8")).toBe(before);
  }, 60_000);

  it("removes Python from analysedLanguages left by an earlier run with the pack", async () => {
    const { run, inventoryPath } = await phaseOne();
    // What a run with the pack leaves; then the pack is removed and only phase 2 re-runs.
    const withPack = JSON.parse(readFileSync(inventoryPath, "utf-8")) as Inventory;
    withPack.summary.analysedLanguages = ["Python", "TypeScript"];
    writeFileSync(inventoryPath, toCanonicalJSON(withPack));
    const rerun: AnalyzeContext = { ...run, inventoryResult: null };

    await runImportsPhase(rerun);
    const after = JSON.parse(readFileSync(inventoryPath, "utf-8")) as Inventory;
    expect(after.summary.analysedLanguages).toEqual(["TypeScript"]);
    expect(after.summary.byLanguage["Python"]).toBe(2);
  }, 60_000);
});
