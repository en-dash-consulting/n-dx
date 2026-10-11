/**
 * The door, headless: the tools it lets through (Graview's `mcpDoor` and
 * `mcpClient` refuse every other), and the byte ranges it serves the
 * snapshot by, so the loop reads two kinds of it.
 */
import { describe, expect, it } from "vitest";
import { ALLOWED_TOOLS, rangeOf } from "../dev/ndx-door.js";

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
});
