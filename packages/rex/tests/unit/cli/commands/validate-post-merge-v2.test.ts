/**
 * `rex validate --post-merge` on a v2 tree: the residue a merge leaves when it
 * drops one copy of an item — a state row and blockedBy refs naming its id.
 *
 * @see packages/rex/src/core/post-merge-validate-v2.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectV2PostMergeIssues, repairV2PostMergeIssues } from "../../../../src/core/post-merge-validate-v2.js";
import { cmdValidate } from "../../../../src/cli/commands/validate.js";

function md(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) lines.push(`${key}:`, ...value.map((v) => `  - ${JSON.stringify(v)}`));
    else lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return [...lines, "---", ""].join("\n");
}

function state(rows: Record<string, string>): string {
  const ids = Object.keys(rows).sort();
  return ['schema: "rex/v2"', "items:", ...ids.flatMap((id) => [`  "${id}":`, `    status: "${rows[id]}"`]), ""].join("\n");
}

let dir: string;
let rexDir: string;
let change: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "post-merge-v2-"));
  rexDir = join(dir, ".rex");
  change = join(rexDir, "changes", "some-change");
  await mkdir(join(rexDir, "product"), { recursive: true });
  await mkdir(change, { recursive: true });
  await writeFile(join(rexDir, "product", "index.md"), md({ title: "P", schema: "rex/v2" }));
  await writeFile(join(change, "index.md"), md({ id: "c", type: "change", title: "Some change" }));
  // The merge kept the base's "Add a widget" (B) and dropped this branch's (X).
  await writeFile(join(change, "add-a-widget.md"), md({ id: "B", type: "task", title: "Add a widget" }));
  await writeFile(join(change, "other.md"), md({ id: "O", type: "task", title: "Other", blockedBy: ["B", "X"] }));
  await writeFile(join(change, "state.yaml"), state({ B: "pending", X: "in_progress", c: "pending" }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("detectV2PostMergeIssues", () => {
  it("reports the dropped id's state row and blockedBy ref as repairable", async () => {
    const { issues } = await detectV2PostMergeIssues(rexDir);
    expect(issues.map((i) => [i.class, i.path, i.detail, i.repairable])).toEqual([
      ["dangling-blocked-by", "changes/some-change/other.md", ["X"], true],
      ["orphaned-state-row", "changes/some-change/state.yaml", ["X"], true],
    ]);
  });

  it("accepts a blockedBy naming a display id or alias", async () => {
    await writeFile(join(change, "add-a-widget.md"), md({ id: "B", displayId: "T-1", aliases: ["old"], title: "Add a widget" }));
    await writeFile(join(change, "other.md"), md({ id: "O", title: "Other", blockedBy: ["T-1", "old"] }));
    await writeFile(join(change, "state.yaml"), state({ B: "pending" }));
    expect((await detectV2PostMergeIssues(rexDir)).issues).toEqual([]);
  });

  it("refuses duplicate ids, conflict markers and unparseable state", async () => {
    await writeFile(join(change, "copy.md"), md({ id: "B", title: "Add a widget" }));
    await mkdir(join(rexDir, "changes", "two"));
    await writeFile(join(rexDir, "changes", "two", "state.yaml"), "<<<<<<< ours\nitems: {}\n=======\n>>>>>>> theirs\n");
    await mkdir(join(rexDir, "changes", "three"));
    await writeFile(join(rexDir, "changes", "three", "state.yaml"), "items:\n  x: pending\n");
    const { issues } = await detectV2PostMergeIssues(rexDir);
    const refused = issues.filter((i) => !i.repairable).map((i) => [i.class, i.path]);
    expect(refused).toEqual([
      ["duplicate-id", "changes/some-change/add-a-widget.md"],
      ["malformed-state", "changes/three/state.yaml"],
      ["conflict-markers", "changes/two/state.yaml"],
    ]);
  });

  it("keeps the row and refs of an item whose file still holds conflict markers", async () => {
    // Both sides edited X's file; it is mid-conflict, not dropped.
    await writeFile(
      join(change, "x.md"),
      ["---", "<<<<<<< ours", 'id: "X"', "=======", 'id: "X"', ">>>>>>> theirs", 'title: "X"', "---", ""].join("\n"),
    );
    const { issues } = await detectV2PostMergeIssues(rexDir);
    expect(issues.map((i) => i.class)).toEqual(["conflict-markers"]);
    await repairV2PostMergeIssues(rexDir, issues);
    expect(await readFile(join(change, "state.yaml"), "utf-8")).toContain('"X"');
    expect(await readFile(join(change, "other.md"), "utf-8")).toContain('"X"');
  });
});

describe("repairV2PostMergeIssues", () => {
  it("drops the dropped id's row and ref, keeping everything else", async () => {
    const { issues } = await detectV2PostMergeIssues(rexDir);
    const { repaired, refused } = await repairV2PostMergeIssues(rexDir, issues);
    expect([repaired.length, refused.length]).toEqual([2, 0]);
    expect((await detectV2PostMergeIssues(rexDir)).issues).toEqual([]);

    const rows = await readFile(join(change, "state.yaml"), "utf-8");
    expect(rows).not.toContain('"X"');
    expect(rows).toContain('"B"');
    expect(rows).toContain('"c"');
    const other = await readFile(join(change, "other.md"), "utf-8");
    expect(other).toContain('blockedBy:\n  - "B"\n');
    expect(other).not.toContain('"X"');
  });
});

describe("cmdValidate --post-merge on v2", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  it("exits 1 while a reference to the dropped id remains", async () => {
    await expect(cmdValidate(dir, { "post-merge": "true" })).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 0 after --repair prunes it", async () => {
    await cmdValidate(dir, { "post-merge": "true", repair: "true" });
    expect(exitSpy).not.toHaveBeenCalled();
    await cmdValidate(dir, { "post-merge": "true" });
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
