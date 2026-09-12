/**
 * GitHub #368 — a cascade must not reach outside the run's own subtree.
 *
 * OBSERVED. `ndx work --task=<x> --auto --yes` hit the account session limit
 * on turn 1. The run record read: status failed, turns 1, tool calls 0,
 * changes none. The agent never ran. Four PRD files came back modified —
 * two for the attempted task's own status, and two in a completely unrelated
 * epic, where an `in_progress` task belonging to another user was closed
 * along with its epic, and `lastModifiedBy` on both was rewritten to whoever
 * happened to be running the command. The task closed was an open
 * investigation with unmet acceptance criteria; its single subtask was
 * completed, and that was the trigger.
 *
 * The mechanism: the session-limit path defers the run's own task, deferring
 * ran the auto-completion sweep, and the sweep was whole-tree.
 *
 * NOT COVERED BY #364. That issue narrowed which CHILD statuses count as done
 * ({completed, deferred} → {completed}). Here the child genuinely is
 * completed, so the narrowed predicate is still satisfied. Two independent
 * predicates — see the module header of rex's core/parent-completion.ts.
 *
 * These tests run against a real folder-tree store, because two of the four
 * guarantees (authorship, and "nothing else on disk moved") are only
 * observable after a round-trip through the backend.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore, SCHEMA_VERSION } from "../../src/prd/rex-gateway.js";
import type { PRDStore, PRDItem } from "../../src/prd/rex-gateway.js";
import { toolRexUpdateStatus } from "../../src/tools/rex.js";
import { handleRunFailure } from "../../src/agent/lifecycle/shared.js";

/** The colleague whose work the incident swept up. */
const OTHER_AUTHOR = "sterling.h@endash.us";

/**
 * The incident's exact shape: the run's epic, and a second epic holding an
 * `in_progress` task whose only child is completed.
 */
function twoSiblingEpics(): PRDItem[] {
  return [
    {
      id: "epic-run",
      title: "Epic under the run",
      level: "epic",
      status: "pending",
      children: [
        { id: "task-run", title: "The task the run targeted", level: "task", status: "in_progress" },
      ],
    },
    {
      id: "epic-other",
      title: "Testing and documentation",
      level: "epic",
      status: "pending",
      lastModified: "2020-01-01T00:00:00.000Z",
      lastModifiedBy: OTHER_AUTHOR,
      children: [
        {
          id: "task-other",
          title: "rex fails intermittently under concurrent import",
          level: "task",
          status: "in_progress",
          acceptanceCriteria: ["Root cause identified", "Fix landed with a regression test"],
          lastModified: "2020-01-01T00:00:00.000Z",
          lastModifiedBy: OTHER_AUTHOR,
          children: [
            {
              id: "sub-other",
              title: "Reproduce the failure locally",
              level: "subtask",
              status: "completed",
              lastModified: "2020-01-01T00:00:00.000Z",
              lastModifiedBy: OTHER_AUTHOR,
            },
          ],
        },
      ],
    },
  ] as PRDItem[];
}

describe("cascade containment (GH #368)", () => {
  let tmpDir: string;
  let rexDir: string;
  let store: PRDStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-cascade-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: SCHEMA_VERSION, project: "cascade", adapter: "folder-tree" }),
      "utf-8",
    );
    store = await resolveStore(rexDir);
    await store.saveDocument({
      schema: SCHEMA_VERSION,
      title: "Cascade Containment",
      items: twoSiblingEpics(),
    });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const get = async (id: string) => (await store.getItem(id))!;

  describe("a run that made zero tool calls", () => {
    /** What the session-limit path actually does: defer the run's own task. */
    const sessionLimit = () =>
      handleRunFailure(store, "task-run", "deferred", "session_limit", "Account session limit reached");

    it("changes only its own task's status", async () => {
      await sessionLimit();

      expect((await get("task-run")).status).toBe("deferred");
      expect((await get("epic-run")).status).toBe("pending");
      expect((await get("task-other")).status).toBe("in_progress");
      expect((await get("epic-other")).status).toBe("pending");
      expect((await get("sub-other")).status).toBe("completed");
    });

    it("does not rewrite authorship on items it never intended to touch", async () => {
      await sessionLimit();

      expect((await get("task-other")).lastModifiedBy).toBe(OTHER_AUTHOR);
      expect((await get("epic-other")).lastModifiedBy).toBe(OTHER_AUTHOR);
      expect((await get("task-other")).lastModified).toBe("2020-01-01T00:00:00.000Z");
    });
  });

  describe("an explicit in_progress parent", () => {
    it("is not closed when its own last child completes", async () => {
      // Complete the subtask through the same tool the agent would use.
      await toolRexUpdateStatus(store, "sub-other", { status: "completed" });

      // The parent claimed the work deliberately and has unmet criteria of
      // its own; the completed child does not speak for it.
      expect((await get("task-other")).status).toBe("in_progress");
      expect((await get("epic-other")).status).toBe("pending");
    });
  });

  describe("containment holds independently of the status predicate", () => {
    it("leaves a sibling epic alone even when it is fully sweepable", async () => {
      // Drop the in_progress guard out of the picture: `task-other` is now
      // pending with every child completed, so only containment can stop it.
      await store.updateItem("task-other", { status: "pending" });

      await handleRunFailure(store, "task-run", "deferred", "session_limit", "Account session limit reached");

      expect((await get("task-other")).status).toBe("pending");
      expect((await get("epic-other")).status).toBe("pending");
    });

    it("still completes the run's own stuck ancestor", async () => {
      // Containment bounds the sweep; it does not disable self-healing.
      await toolRexUpdateStatus(store, "task-run", { status: "completed" });

      expect((await get("epic-run")).status).toBe("completed");
    });
  });
});
