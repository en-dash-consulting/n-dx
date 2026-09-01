/**
 * `rex validate --post-merge` — structural check for a freshly merged PRD tree.
 *
 * A git merge of `.rex/prd_tree/` can leave corruption no ordinary code path
 * produces: duplicate IDs (both branches added the same item at different
 * paths), orphaned directories, level/nesting mismatches, dangling blockedBy
 * references, and unresolved conflict markers. One fixture per class below;
 * `--repair` fixes the deterministic classes and refuses the ambiguous ones.
 *
 * @see packages/rex/src/core/post-merge-validate.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectPostMergeIssues,
  repairPostMergeIssues,
} from "../../../../src/core/post-merge-validate.js";
import { cmdValidate } from "../../../../src/cli/commands/validate.js";

function md(fields: Record<string, unknown>, body = ""): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${JSON.stringify(v)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---", "");
  if (body) lines.push(body);
  return lines.join("\n");
}

describe("post-merge corruption detection and repair", () => {
  let dir: string;
  let treeRoot: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "post-merge-"));
    treeRoot = join(dir, ".rex", "prd_tree");
    await mkdir(treeRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("passes silently on a healthy tree", async () => {
    await mkdir(join(treeRoot, "epic-aaaaaa"));
    await writeFile(join(treeRoot, "epic-aaaaaa", "index.md"), md({ id: "a", level: "epic", title: "Epic", status: "pending" }));
    await writeFile(join(treeRoot, "epic-aaaaaa", "feat-bbbbbb.md"), md({ id: "b", level: "feature", title: "Feat", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    expect(report.issues).toEqual([]);
  });

  it("detects duplicate IDs across paths and refuses to repair them", async () => {
    await writeFile(join(treeRoot, "one-aaaaaa.md"), md({ id: "dup-1", level: "epic", title: "One", status: "pending" }));
    await writeFile(join(treeRoot, "two-bbbbbb.md"), md({ id: "dup-1", level: "epic", title: "Two", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    const dupes = report.issues.filter((i) => i.class === "duplicate-id");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].repairable).toBe(false);
    expect(dupes[0].message).toContain("one-aaaaaa.md");
    expect(dupes[0].message).toContain("two-bbbbbb.md");

    const { repaired, refused } = await repairPostMergeIssues(treeRoot, report.issues);
    expect(repaired).toHaveLength(0);
    expect(refused).toHaveLength(1);
    // Both files untouched.
    await access(join(treeRoot, "one-aaaaaa.md"));
    await access(join(treeRoot, "two-bbbbbb.md"));
  });

  it("detects an empty orphaned directory (no index.md) and repairs it by removal", async () => {
    await mkdir(join(treeRoot, "husk-dir"));

    const report = await detectPostMergeIssues(treeRoot);
    const orphans = report.issues.filter((i) => i.class === "orphaned-directory");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].repairable).toBe(true);

    const { repaired } = await repairPostMergeIssues(treeRoot, report.issues);
    expect(repaired).toHaveLength(1);
    await expect(access(join(treeRoot, "husk-dir"))).rejects.toThrow();
  });

  it("refuses to repair an orphaned directory that still contains items", async () => {
    await mkdir(join(treeRoot, "headless-dir"));
    await writeFile(join(treeRoot, "headless-dir", "child-cccccc.md"), md({ id: "c", level: "feature", title: "Child", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    const orphans = report.issues.filter((i) => i.class === "orphaned-directory");
    expect(orphans).toHaveLength(1);
    expect(orphans[0].repairable).toBe(false);

    const { refused } = await repairPostMergeIssues(treeRoot, report.issues);
    expect(refused.some((i) => i.class === "orphaned-directory")).toBe(true);
    await access(join(treeRoot, "headless-dir", "child-cccccc.md")); // untouched
  });

  it("detects a level/nesting mismatch and repairs it to the depth-implied level", async () => {
    await mkdir(join(treeRoot, "epic-aaaaaa"));
    await writeFile(join(treeRoot, "epic-aaaaaa", "index.md"), md({ id: "a", level: "epic", title: "Epic", status: "pending" }));
    // A file at feature depth claiming to be an epic.
    await writeFile(join(treeRoot, "epic-aaaaaa", "impostor-dddddd.md"), md({ id: "d", level: "epic", title: "Impostor", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    const mismatches = report.issues.filter((i) => i.class === "level-mismatch");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repairable).toBe(true);

    await repairPostMergeIssues(treeRoot, report.issues);
    const repairedContent = await readFile(join(treeRoot, "epic-aaaaaa", "impostor-dddddd.md"), "utf-8");
    expect(repairedContent).toContain('level: "feature"');
    // Everything else survives untouched.
    expect(repairedContent).toContain('title: "Impostor"');

    const after = await detectPostMergeIssues(treeRoot);
    expect(after.issues).toEqual([]);
  });

  it("detects dangling blockedBy references and repairs by dropping only the dangling ids", async () => {
    await writeFile(
      join(treeRoot, "epic-aaaaaa.md"),
      md({ id: "a", level: "epic", title: "A", status: "pending", blockedBy: ["b", "ghost-1", "ghost-2"] }),
    );
    await writeFile(join(treeRoot, "epic-bbbbbb.md"), md({ id: "b", level: "epic", title: "B", status: "pending" }));

    const report = await detectPostMergeIssues(treeRoot);
    const dangling = report.issues.filter((i) => i.class === "dangling-blocked-by");
    expect(dangling).toHaveLength(1);
    expect(dangling[0].repairable).toBe(true);
    expect(dangling[0].message).toContain("ghost-1");

    await repairPostMergeIssues(treeRoot, report.issues);
    const repairedContent = await readFile(join(treeRoot, "epic-aaaaaa.md"), "utf-8");
    expect(repairedContent).toContain('- "b"'); // valid reference kept
    expect(repairedContent).not.toContain("ghost-1");
    expect(repairedContent).not.toContain("ghost-2");
  });

  it("removes the blockedBy field entirely when every reference is dangling", async () => {
    await writeFile(
      join(treeRoot, "epic-aaaaaa.md"),
      md({ id: "a", level: "epic", title: "A", status: "pending", blockedBy: ["ghost"] }),
    );

    const report = await detectPostMergeIssues(treeRoot);
    await repairPostMergeIssues(treeRoot, report.issues);
    const repairedContent = await readFile(join(treeRoot, "epic-aaaaaa.md"), "utf-8");
    expect(repairedContent).not.toContain("blockedBy");
    expect((await detectPostMergeIssues(treeRoot)).issues).toEqual([]);
  });

  it("detects unresolved conflict markers and refuses to repair them", async () => {
    await writeFile(
      join(treeRoot, "epic-aaaaaa.md"),
      ["---", 'id: "a"', "<<<<<<< ours", 'status: "completed"', "=======", 'status: "failing"', ">>>>>>> theirs", "---", ""].join("\n"),
    );

    const report = await detectPostMergeIssues(treeRoot);
    const markers = report.issues.filter((i) => i.class === "conflict-markers");
    expect(markers).toHaveLength(1);
    expect(markers[0].repairable).toBe(false);

    const { refused } = await repairPostMergeIssues(treeRoot, report.issues);
    expect(refused.some((i) => i.class === "conflict-markers")).toBe(true);
  });
});

describe("rex validate --post-merge CLI", () => {
  let dir: string;
  let treeRoot: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "post-merge-cli-"));
    treeRoot = join(dir, ".rex", "prd_tree");
    await mkdir(treeRoot, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("exits 0 on a healthy tree (hook-friendly)", async () => {
    await writeFile(join(treeRoot, "epic-aaaaaa.md"), md({ id: "a", level: "epic", title: "A", status: "pending" }));
    await cmdValidate(dir, { "post-merge": "true" });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 0 when there is no PRD tree at all — hooks in non-PRD repos are no-ops", async () => {
    await rm(treeRoot, { recursive: true, force: true });
    await cmdValidate(dir, { "post-merge": "true" });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 when corruption is found", async () => {
    await writeFile(join(treeRoot, "one-aaaaaa.md"), md({ id: "dup", level: "epic", title: "One", status: "pending" }));
    await writeFile(join(treeRoot, "two-bbbbbb.md"), md({ id: "dup", level: "epic", title: "Two", status: "pending" }));

    await expect(cmdValidate(dir, { "post-merge": "true" })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("with --repair, exits 0 once the safe classes are fixed", async () => {
    await mkdir(join(treeRoot, "husk-dir")); // repairable
    await writeFile(
      join(treeRoot, "epic-aaaaaa.md"),
      md({ id: "a", level: "epic", title: "A", status: "pending", blockedBy: ["ghost"] }), // repairable
    );

    await cmdValidate(dir, { "post-merge": "true", repair: "true" });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("with --repair, still exits 1 when ambiguous corruption remains", async () => {
    await writeFile(join(treeRoot, "one-aaaaaa.md"), md({ id: "dup", level: "epic", title: "One", status: "pending" }));
    await writeFile(join(treeRoot, "two-bbbbbb.md"), md({ id: "dup", level: "epic", title: "Two", status: "pending" }));

    await expect(cmdValidate(dir, { "post-merge": "true", repair: "true" })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
