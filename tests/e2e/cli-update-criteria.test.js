import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runResult, createTmpDir, removeTmpDir, setupRexDir } from "./e2e-helpers.js";

describe("ndx update --criterion / --source", { timeout: 60_000 }, () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-update-criteria-e2e-");
    await setupRexDir(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  /** Read the item's markdown (`<slug>.md` for a leaf, `<slug>/index.md` otherwise). */
  async function readItem(slug) {
    const treeDir = join(tmpDir, ".rex", "prd_tree");
    const entries = await readdir(treeDir, { recursive: true });
    const match = entries.find((p) => new RegExp(`(^|/)${slug}(\\.md|/index\\.md)$`).test(p));
    expect(match, `no file for ${slug} among: ${entries.join(", ")}`).toBeDefined();
    return readFile(join(treeDir, match), "utf-8");
  }

  it("replaces then clears acceptance criteria, reading the item back each time", async () => {
    const first = runResult(
      ["rex", "update", "task-2", "--criterion=X", "--criterion", "Y", "--source=ndx-capture", tmpDir],
    );
    expect(first.stderr).not.toMatch(/Error/);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("acceptanceCriteria: 2 criteria");

    let md = await readItem("another-task");
    expect(md).toMatch(/^acceptanceCriteria:\n\s+- "?X"?\n\s+- "?Y"?\n(?!\s+- )/m);
    expect(md).toMatch(/^source: "?ndx-capture"?$/m);

    const second = runResult(["rex", "update", "task-2", "--criterion=", "--source=", tmpDir]);
    expect(second.stderr).not.toMatch(/Error/);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("acceptanceCriteria: cleared");

    md = await readItem("another-task");
    expect(md).not.toMatch(/^\s+- "?[XY]"?$/m);
    expect(md).not.toMatch(/^source:/m);

    // The cleared item still loads through the folder tree.
    const status = runResult(["rex", "update", "task-2", "--priority=high", tmpDir]);
    expect(status.code).toBe(0);
  });
});
