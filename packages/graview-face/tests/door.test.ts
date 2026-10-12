/**
 * The door, headless: the tools it lets through (Graview's `mcpDoor` and
 * `mcpClient` refuse every other), and the byte ranges it serves the
 * snapshot by, so the loop reads two kinds of it.
 */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_TOOLS, projectStamp, rangeOf } from "../dev/ndx-door.js";

describe("the door", () => {
  it("passes only the four tools the sync loop uses", () => {
    expect([...ALLOWED_TOOLS].sort()).toEqual(["append_log", "edit_item", "get_item", "update_task_status"]);
    for (const tool of ["merge_items", "move_item", "reorganize", "add_item", "apply_change", "place_change"]) expect(ALLOWED_TOOLS.has(tool), tool).toBe(false);
  });

  it("serves the one byte range a snapshot reader asks for, clamped to the file", () => {
    expect(rangeOf("bytes=0-65535", 100)).toEqual({ start: 0, end: 99 });
    expect(rangeOf("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(rangeOf("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(rangeOf("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("serves the whole file for no range, or one it cannot serve", () => {
    expect(rangeOf(undefined, 100)).toBeUndefined();
    expect(rangeOf("bytes=100-200", 100)).toBeUndefined();
    expect(rangeOf("bytes=20-10", 100)).toBeUndefined();
    expect(rangeOf("bytes=0-10,20-30", 100)).toBeUndefined();
    expect(rangeOf("items=0-10", 100)).toBeUndefined();
  });

  it("stamps what a projection reads, so an unchanged project is not re-emitted and any edit, addition or removal is", () => {
    const root = mkdtempSync(join(tmpdir(), "ndx-door-"));
    try {
      const tree = join(root, ".rex", "prd_tree", "a-change");
      mkdirSync(tree, { recursive: true });
      const file = join(tree, "index.md");
      writeFileSync(file, "---\ntitle: A\n---\n");
      const past = new Date(Date.now() - 60_000);
      utimesSync(file, past, past);
      const first = projectStamp(root);
      expect(projectStamp(root)).toBe(first);
      // A cache under .rex is not something the projection reads.
      mkdirSync(join(root, ".rex", ".cache"));
      writeFileSync(join(root, ".rex", ".cache", "prd.json"), "{}");
      writeFileSync(file, "---\ntitle: B\n---\n");
      const edited = projectStamp(root);
      expect(edited).not.toBe(first);
      writeFileSync(join(root, ".rex", "prd_tree", "other.md"), "x");
      const added = projectStamp(root);
      expect(added).not.toBe(edited);
      unlinkSync(join(root, ".rex", "prd_tree", "other.md"));
      expect(projectStamp(root)).not.toBe(added);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
