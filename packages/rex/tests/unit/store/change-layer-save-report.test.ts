/**
 * ChangeLayerStore's save report: the v2 counterpart of FileStore's, so hench
 * can scope its PRD commit to the files a write touched instead of staging
 * the whole of `product/` and `changes/`.
 *
 * Each test diffs the tree on disk before and after the write and requires the
 * report to name exactly those files, project-relative, and to drain on take.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { resolveStore } from "../../../src/store/index.js";
import { ChangeLayerStore } from "../../../src/store/change-layer-store.js";
import { takeSaveFileReport } from "../../../src/store/contracts.js";
import { completeV2Work } from "../../../src/cli/v2-completion.js";
import { copyV2Fixture, editText } from "../../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

/** Every file under `product/` and `changes/`, project-relative, with its content. */
async function snapshot(projectDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const layer of ["product", "changes"]) {
    const dir = join(projectDir, ".rex", layer);
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      files.set(relative(projectDir, path).split("\\").join("/"), await readFile(path, "utf-8"));
    }
  }
  return files;
}

/** The files `after` added or changed, and the ones it lost. */
function diff(before: Map<string, string>, after: Map<string, string>): { written: string[]; deleted: string[] } {
  return {
    written: [...after].filter(([p, text]) => before.get(p) !== text).map(([p]) => p).sort(),
    deleted: [...before.keys()].filter((p) => !after.has(p)).sort(),
  };
}

describe("ChangeLayerStore save report", () => {
  let projectDir: string;
  let store: ChangeLayerStore;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-v2-save-report-"));
    const rexDir = await copyV2Fixture(join(projectDir, ".rex"), "lf");
    await writeFile(join(rexDir, "config.json"), toCanonicalJSON({ schema: SCHEMA_VERSION, project: "t", adapter: "file" }));
    store = (await resolveStore(rexDir)) as ChangeLayerStore;
    expect(store).toBeInstanceOf(ChangeLayerStore);
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("is null before any write", () => {
    expect(takeSaveFileReport(store)).toBeNull();
  });

  it("names exactly the files a write rewrote, and drains on take", async () => {
    const before = await snapshot(projectDir);
    await store.updateItem(TASK, { title: "Wire the Apple Pay button", status: "in_progress" });
    const expected = diff(before, await snapshot(projectDir));

    const report = takeSaveFileReport(store);
    expect(expected.written.length).toBeGreaterThan(0);
    expect({ written: [...report!.written].sort(), deleted: [...report!.deleted].sort() }).toEqual(expected);
    expect(takeSaveFileReport(store)).toBeNull();
  });

  it("lists every file of a removed folder, not the folder", async () => {
    await store.addItem({ id: "s1", title: "Hide on Chrome", level: "subtask", status: "pending" }, TASK);
    takeSaveFileReport(store);

    const before = await snapshot(projectDir);
    await store.removeItem("s1");
    const expected = diff(before, await snapshot(projectDir));

    const report = takeSaveFileReport(store)!;
    expect(expected.deleted).toContain(".rex/changes/add-apple-pay/wire-the-button/index.md");
    expect({ written: [...report.written].sort(), deleted: [...report.deleted].sort() }).toEqual(expected);
  });

  it("accumulates the union of several writes between takes", async () => {
    const before = await snapshot(projectDir);
    await store.updateItem(TASK, { priority: "high" });
    await store.addItem({ id: "t2", title: "Show the sheet", level: "task", status: "pending" }, CHANGE);
    const expected = diff(before, await snapshot(projectDir));

    const report = takeSaveFileReport(store)!;
    expect(expected.written).toContain(".rex/changes/add-apple-pay/show-the-sheet.md");
    expect({ written: [...report.written].sort(), deleted: [...report.deleted].sort() }).toEqual(expected);
  });

  it("includes completeV2Work's completion and the product files its apply touched", async () => {
    // Only a pending change completes with its last task.
    await editText(join(projectDir, ".rex/changes/add-apple-pay/state.yaml"), (t) => t.replace('status: "in_progress"', 'status: "pending"'));
    const before = await snapshot(projectDir);
    const done = await completeV2Work(store, TASK);
    const expected = diff(before, await snapshot(projectDir));

    expect(done.applied).toBe(true);
    expect(expected.written).toContain(".rex/product/checkout/pay-by-card.md");
    expect(expected.written).toContain(".rex/changes/add-apple-pay/state.yaml");
    const report = takeSaveFileReport(store)!;
    expect({ written: [...report.written].sort(), deleted: [...report.deleted].sort() }).toEqual(expected);
    expect(takeSaveFileReport(store)).toBeNull();
  });
});
