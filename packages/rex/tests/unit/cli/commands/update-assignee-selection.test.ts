/**
 * End-to-end check for the `assignee` write path.
 *
 * `assignee` was readable by selection long before anything could write it, so
 * the filter matched a field only hand-edited frontmatter could set. These
 * tests close that loop: write through the CLI and through MCP `edit_item`,
 * persist to the folder tree, read back, and confirm selection picks the item
 * up for that identity and skips it for another.
 *
 * The in-memory filter semantics (inheritance, exact match) are covered by
 * tests/unit/core/assignee-filtered-task.test.ts — this file covers the seam
 * between the writers and that filter.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { cmdUpdate } from "../../../../src/cli/commands/update.js";
import { handleEditItem } from "../../../../src/cli/mcp-tools/index.js";
import { findNextTask } from "../../../../src/core/next-task.js";
import { resolveStore, resolveRexPaths } from "../../../../src/store/index.js";
import { readPRD, writePRD } from "../../../helpers/rex-dir-test-support.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

const MINE = "Sterling H <sterling.h@endash.us>";
const THEIRS = "Ryan Keith <ryan.k@endash.us>";

describe("assignee round-trips from the writers into task selection", () => {
  let tmp: string;
  const quiet = { quiet: "true" };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-assignee-selection-"));
    mkdirSync(join(tmp, ".rex"));
    // A task must sit under a feature for the folder-tree serializer to
    // represent it; a bare task under an epic is dropped on sync.
    writePRD(tmp, {
      schema: "rex/v1",
      title: "test",
      items: [
        {
          id: "epic-1",
          title: "Epic",
          level: "epic",
          status: "pending",
          children: [
            {
              id: "feature-1",
              title: "Feature",
              level: "feature",
              status: "pending",
              children: [
                { id: "task-a", title: "Task A", level: "task", status: "pending", priority: "high" },
                { id: "task-b", title: "Task B", level: "task", status: "pending", priority: "critical" },
              ],
            },
          ],
        },
      ],
    } as PRDDocument);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("selects a CLI-assigned task for its assignee and skips it for another", async () => {
    await cmdUpdate(tmp, "task-a", { assignee: MINE, ...quiet });

    const items = readPRD(tmp).items;
    // Without a filter the higher-priority task still wins.
    expect(findNextTask(items, new Set())!.item.id).toBe("task-b");
    // Filtered to the assignee, only the assigned task is actionable.
    expect(findNextTask(items, new Set(), { assignee: MINE })!.item.id).toBe("task-a");
    expect(findNextTask(items, new Set(), { assignee: THEIRS })).toBeNull();
  });

  it("selects an MCP-assigned task for its assignee", async () => {
    const store = await resolveStore(resolveRexPaths(tmp).rexDir);
    await handleEditItem(store, tmp, { id: "task-b", assignee: MINE });

    const items = readPRD(tmp).items;
    expect(findNextTask(items, new Set(), { assignee: MINE })!.item.id).toBe("task-b");
    expect(findNextTask(items, new Set(), { assignee: THEIRS })).toBeNull();
  });

  it("stops selecting the task once the assignee is cleared", async () => {
    await cmdUpdate(tmp, "task-a", { assignee: MINE, ...quiet });
    expect(findNextTask(readPRD(tmp).items, new Set(), { assignee: MINE })!.item.id).toBe("task-a");

    await cmdUpdate(tmp, "task-a", { assignee: "", ...quiet });
    expect(findNextTask(readPRD(tmp).items, new Set(), { assignee: MINE })).toBeNull();
  });

  it("gives a parent's assignee to its descendants", async () => {
    // matchesAssignee walks the parent chain, so assigning the feature makes
    // both of its tasks selectable for that identity.
    await cmdUpdate(tmp, "feature-1", { assignee: MINE, ...quiet });

    const items = readPRD(tmp).items;
    expect(findNextTask(items, new Set(), { assignee: MINE })!.item.id).toBe("task-b");
    expect(findNextTask(items, new Set(), { assignee: THEIRS })).toBeNull();
  });
});
