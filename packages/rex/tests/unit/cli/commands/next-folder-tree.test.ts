/**
 * Tests for `rex next` reading items from the folder tree.
 *
 * Verifies that `cmdNext` selects the same task regardless of whether items
 * come from the tree (direct read) or are auto-migrated from prd.json.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdNext } from "../../../../src/cli/commands/next.js";
import { serializeFolderTree } from "../../../../src/store/index.js";
import type { PRDDocument } from "../../../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../../../src/store/index.js";

const NEXT_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Next Folder Tree Test",
  items: [
    {
      id: "e1",
      title: "Epic One",
      level: "epic",
      status: "in_progress",
      children: [
        {
          id: "f1",
          title: "Feature One",
          level: "feature",
          status: "in_progress",
          acceptanceCriteria: [],
          children: [
            {
              id: "t1",
              title: "Task Alpha",
              level: "task",
              status: "completed",
              acceptanceCriteria: [],
            },
            {
              id: "t2",
              title: "Task Beta",
              level: "task",
              status: "pending",
              priority: "high",
              acceptanceCriteria: ["Do something"],
            },
          ],
        },
      ],
    },
  ],
};

describe("cmdNext — folder tree read path", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-next-tree-test-"));
    mkdirSync(join(tmp, ".rex"), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true });
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
  }

  it("selects next task from folder tree when tree exists", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(NEXT_PRD));
    await serializeFolderTree(NEXT_PRD.items, join(tmp, ".rex", PRD_TREE_DIRNAME));

    await cmdNext(tmp, {});
    expect(output()).toContain("Task Beta");
  });

  it("selects same task when reading from legacy prd.json fallback", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(NEXT_PRD));
    // No tree pre-created — FileStore.loadDocument falls back to prd.json
    // (read-only). The folder tree is no longer auto-created on read.

    await cmdNext(tmp, {});

    expect(output()).toContain("Task Beta");
  });

  it("selects the same task regardless of whether tree was pre-created", async () => {
    writeFileSync(join(tmp, ".rex", "prd.json"), JSON.stringify(NEXT_PRD));

    // Run 1: tree absent → auto-migrate
    await cmdNext(tmp, { format: "json" });
    const firstCalls = [...logSpy.mock.calls];
    logSpy.mockClear();

    // Run 2: tree present → direct read
    await cmdNext(tmp, { format: "json" });
    const secondCalls = [...logSpy.mock.calls];

    const parse = (calls: typeof firstCalls) => {
      for (const [line] of calls) {
        try {
          return JSON.parse(line);
        } catch {
          continue;
        }
      }
      return null;
    };

    const first = parse(firstCalls);
    const second = parse(secondCalls);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first.item.id).toBe(second.item.id);
    expect(first.item.title).toBe(second.item.title);
  });
});
