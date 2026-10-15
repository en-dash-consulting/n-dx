/**
 * Save reports on the `.ndx/` layout, where rexDir is `<root>/.ndx/rex`.
 *
 * The SaveFileReport contract is project-relative. Measured against
 * `dirname(rexDir)` the paths came out as `rex/prd_tree/...`, and hench's
 * commit scoping (which keeps only `.ndx/rex/prd_tree/...`) dropped them all.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../../../src/store/file-adapter.js";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../../src/store/folder-tree-store.js";
import { takeSaveFileReport } from "../../../src/store/contracts.js";
import { clearPerfFlagCache } from "../../../src/store/perf-flags.js";
import { PRD_TREE_DIRNAME } from "../../../src/store/paths.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDItem } from "../../../src/schema/index.js";

const PREFIX = ".ndx/rex/prd_tree/";

const ITEMS: PRDItem[] = [
  {
    id: "e1", title: "Platform Work", level: "epic", status: "pending",
    children: [{ id: "t1", title: "Add a button", level: "task", status: "pending" } as PRDItem],
  } as PRDItem,
];

function expectProjectRelative(report: ReturnType<typeof takeSaveFileReport>): void {
  expect(report).not.toBeNull();
  expect(report!.written.length).toBeGreaterThan(0);
  for (const path of [...report!.written, ...report!.deleted]) {
    expect(path.startsWith(PREFIX), path).toBe(true);
  }
}

describe("save reports on the .ndx/ layout", () => {
  let tmp: string;
  let rexDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "rex-ndx-save-report-"));
    rexDir = join(tmp, ".ndx", "rex");
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
  });

  afterEach(async () => {
    delete process.env["REX_FAST_WRITES"];
    clearPerfFlagCache();
    await rm(tmp, { recursive: true, force: true });
  });

  it("FileStore's full write reports paths under .ndx/rex/prd_tree/", async () => {
    await mkdir(join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
    const store = new FileStore(rexDir, { currentBranchFile: "prd.json" });
    await store.saveDocument({ schema: SCHEMA_VERSION, title: "Fixture", items: structuredClone(ITEMS) });

    expectProjectRelative(takeSaveFileReport(store));
  });

  it("FileStore's targeted write reports paths under .ndx/rex/prd_tree/", async () => {
    await mkdir(join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
    await new FileStore(rexDir, { currentBranchFile: "prd.json" })
      .saveDocument({ schema: SCHEMA_VERSION, title: "Fixture", items: structuredClone(ITEMS) });

    process.env["REX_FAST_WRITES"] = "1";
    clearPerfFlagCache();
    const store = new FileStore(rexDir, { currentBranchFile: "prd.json" });
    await store.updateItem("t1", { status: "completed" });

    expectProjectRelative(takeSaveFileReport(store));
  });

  it("FolderTreeStore reports paths under .ndx/rex/prd_tree/", async () => {
    await ensureFolderTreeRexDir(rexDir);
    const store = new FolderTreeStore(rexDir);
    await store.addItem({ id: "e1", title: "Epic One", status: "pending", level: "epic" });

    const report = takeSaveFileReport(store);
    expect(report!.written).toEqual([`${PREFIX}epic-one.md`]);
  });
});
