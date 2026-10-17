/**
 * inventory.json's analysedLanguages lists Java only when the Java pack ran,
 * as for Python: the inventory phase leaves Java out, the imports phase adds
 * it when `@n-dx/lang-java` analysed the files, and an imports-only re-run
 * (`sv analyze --phase=2`) after the pack is removed drops it. The missing
 * pack is simulated at the loader, as in python-analysed-languages-rerun.test.ts.
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
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const javaPack = vi.hoisted(() => ({ installed: true }));

vi.mock("../../src/language/pack-loader.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/language/pack-loader.js")>();
  const notInstalled = () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-java' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" }));
  const toggled = <P extends { id: string; importByResolution: () => Promise<unknown> }>(pack: P): P =>
    pack.id !== "java" ? pack : { ...pack, importByResolution: () => (javaPack.installed ? pack.importByResolution() : notInstalled()) };
  return {
    ...original,
    KNOWN_PACKS: original.KNOWN_PACKS.map(toggled),
    INSTALLABLE_PACKS: original.INSTALLABLE_PACKS.map(toggled),
  };
});

const FILES: Record<string, string> = {
  "pom.xml":
    '<project><modelVersion>4.0.0</modelVersion><groupId>com.shop</groupId><artifactId>shop</artifactId><version>1.0</version></project>\n',
  "src/main/java/com/shop/App.java": "package com.shop;\n\nimport com.shop.orders.Orders;\n\npublic class App {\n  Orders orders;\n}\n",
  "src/main/java/com/shop/orders/Orders.java": "package com.shop.orders;\n\npublic class Orders {}\n",
};

describe("analysedLanguages in a Java-root repository", () => {
  let project: string | null = null;
  afterEach(() => {
    if (project) rmSync(project, { recursive: true, force: true });
    project = null;
    javaPack.installed = true;
    vi.restoreAllMocks();
  });

  async function phaseOne(): Promise<{ run: AnalyzeContext; readInventory: () => Inventory; inventoryPath: string }> {
    project = mkdtempSync(join(tmpdir(), "sv-java-analysed-"));
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
    const inventoryPath = join(run.svDir, "inventory.json");
    return { run, inventoryPath, readInventory: () => JSON.parse(readFileSync(inventoryPath, "utf-8")) as Inventory };
  }

  it("leaves Java out without the pack, and the imports phase leaves inventory.json alone", async () => {
    javaPack.installed = false;
    const { run, inventoryPath, readInventory } = await phaseOne();
    const before = readFileSync(inventoryPath, "utf-8");
    expect(readInventory().summary.byLanguage["Java"]).toBe(2);
    expect(readInventory().summary.analysedLanguages).toEqual([]);
    await runImportsPhase(run);
    expect(readFileSync(inventoryPath, "utf-8")).toBe(before);
  }, 60_000);

  it("lists Java after the imports phase when the pack ran, and drops it on a --phase=2 re-run without the pack", async (ctx) => {
    await skipUnlessPackRuns(ctx, "java");
    const { run, readInventory } = await phaseOne();
    expect(readInventory().summary.analysedLanguages).toEqual([]);
    await runImportsPhase(run);
    expect(readInventory().summary.analysedLanguages).toEqual(["Java"]);
    expect(run.inventoryResult?.summary.analysedLanguages).toEqual(["Java"]);

    javaPack.installed = false;
    await runImportsPhase({ ...run, inventoryResult: null });
    const after = readInventory();
    expect(after.summary.analysedLanguages).toEqual([]);
    expect(after.summary.byLanguage["Java"]).toBe(2);
  }, 60_000);
});
