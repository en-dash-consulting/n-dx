/**
 * Withdrawing a completion must reopen the ancestors it closed (#370 review, finding 6).
 *
 * OBSERVED SHAPE. Feature F has one remaining task T. The agent calls
 * `rex_update_status(T, completed)`; the contained cascade in
 * `toolRexUpdateStatus` closes F and F's epic. The uncommitted-work gate
 * (#363) then refuses the completion and `withdrawCompletionClaim` resets T to
 * `pending` — but `toolRexUpdateStatus` cascades only on `completed`/`deferred`,
 * so F and the epic stay `completed`. That is the parent/child inconsistency
 * `rex validate` warns about, and nothing in the run loop repairs it: on the
 * rerun T completes, F is already completed, and F is never re-verified.
 *
 * Real folder-tree store and a real git repo, because the guarantees under test
 * — the ancestors' status on disk and their preserved authorship (#368) — are
 * only observable after a round-trip through the backend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveStore, SCHEMA_VERSION } from "../../src/prd/rex-gateway.js";
import type { PRDStore, PRDItem } from "../../src/prd/rex-gateway.js";
import { toolRexUpdateStatus } from "../../src/tools/rex.js";
import { finalizeRun } from "../../src/agent/lifecycle/shared.js";
import { initConfig } from "../../src/store/config.js";
import { initGitFixtureRepo } from "../helpers/index.js";
import type { RunRecord } from "../../src/schema/index.js";

const run = promisify(execFile);

/** The colleague who last touched the ancestors. Their authorship must survive. */
const OTHER_AUTHOR = "sterling.h@endash.us";
const STAMP = "2020-01-01T00:00:00.000Z";

const TASK_ID = "task-last-child";

/** Epic → feature → the run's task, the task being the feature's only child. */
function epicFeatureTask(extraEpicChildren: PRDItem[] = [], epicStatus = "pending"): PRDItem[] {
  return [
    {
      id: "epic-1",
      title: "The epic",
      level: "epic",
      status: epicStatus,
      lastModified: STAMP,
      lastModifiedBy: OTHER_AUTHOR,
      ...(epicStatus === "completed" ? { completedAt: STAMP } : {}),
      children: [
        {
          id: "feature-1",
          title: "The feature",
          level: "feature",
          status: "pending",
          lastModified: STAMP,
          lastModifiedBy: OTHER_AUTHOR,
          children: [
            {
              id: TASK_ID,
              title: "The last task",
              level: "task",
              status: "in_progress",
            },
          ],
        },
        ...extraEpicChildren,
      ],
    },
  ] as PRDItem[];
}

describe("withdrawCompletionClaim — ancestor reopening", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let store: PRDStore;

  async function seed(items: PRDItem[]): Promise<void> {
    await store.saveDocument({ schema: SCHEMA_VERSION, title: "Withdrawal", items });
    await run("git", ["add", "-A"], { cwd: projectDir });
    await run("git", ["commit", "-m", "chore(prd): seed"], { cwd: projectDir });
  }

  const get = async (id: string) => (await store.getItem(id))!;

  /** What the agent does before the gate fires: claim the task, cascade upward. */
  async function agentClaimsCompletion(): Promise<void> {
    await toolRexUpdateStatus(store, TASK_ID, { status: "completed" });
    await run("git", ["add", "-A"], { cwd: projectDir });
    await run("git", ["commit", "-m", "chore(prd): agent status write"], { cwd: projectDir });
  }

  /** Finish the run with the agent's own work left uncommitted, tripping the gate. */
  async function finalizeWithLeakedWork(): Promise<RunRecord> {
    await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");

    const record: RunRecord = {
      id: randomUUID(),
      taskId: TASK_ID,
      taskTitle: "The last task",
      startedAt: new Date().toISOString(),
      status: "completed",
      turns: 3,
      tokenUsage: { input: 100, output: 50 },
      turnTokenUsage: [],
      toolCalls: [],
      model: "test-model",
    };

    await (finalizeRun as Function)({
      run: record,
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      autonomous: true,
      store,
    });
    return record;
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-withdraw-ancestors-"));
    henchDir = join(projectDir, ".hench");
    rexDir = join(projectDir, ".rex");

    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: SCHEMA_VERSION, project: "withdrawal", adapter: "folder-tree" }),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);
    store = await resolveStore(rexDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("ancestors the run's own cascade closed", () => {
    beforeEach(async () => {
      await seed(epicFeatureTask());
      await agentClaimsCompletion();
      // Precondition: the cascade really did close both ancestors.
      expect((await get("feature-1")).status).toBe("completed");
      expect((await get("epic-1")).status).toBe("completed");
    });

    it("reopens the parent and the grandparent when the completion is withdrawn", async () => {
      const record = await finalizeWithLeakedWork();

      expect(record.status).toBe("failed");
      expect((await get(TASK_ID)).status).toBe("pending");
      expect((await get("feature-1")).status).toBe("pending");
      expect((await get("epic-1")).status).toBe("pending");
    });

    it("clears the ancestors' completedAt so they do not read as finished", async () => {
      await finalizeWithLeakedWork();

      expect((await get("feature-1")).completedAt).toBeUndefined();
      expect((await get("epic-1")).completedAt).toBeUndefined();
    });

    it("preserves ancestor authorship — reopening is a consequence, not an edit (#368)", async () => {
      await finalizeWithLeakedWork();

      expect((await get("feature-1")).lastModifiedBy).toBe(OTHER_AUTHOR);
      expect((await get("epic-1")).lastModifiedBy).toBe(OTHER_AUTHOR);
    });

    it("logs the reset against the withdrawal, not 'new child added'", async () => {
      await finalizeWithLeakedWork();

      const entries = await store.readLog();
      const resets = entries.filter((e) => e.event === "status_reset");
      expect(resets.map((e) => e.itemId)).toEqual(["feature-1", "epic-1"]);
      for (const entry of resets) {
        expect(entry.detail).toContain("completion withdrawn");
        expect(entry.detail).not.toContain("new child added");
      }
    });
  });

  /**
   * An ancestor that was already `completed` before the run is reopened too.
   * That is `findParentResets` semantics, and it is correct here for the same
   * reason it is correct on the add path: the epic now has a pending
   * descendant, so `completed` is a false statement about it regardless of who
   * wrote it. The deferred sibling feature below keeps this run's cascade off
   * the epic (a deferred child blocks auto-completion), so the epic's
   * `completed` status can only be pre-existing.
   */
  describe("an ancestor completed before the run", () => {
    const deferredSibling: PRDItem = {
      id: "feature-2",
      title: "A deferred sibling feature",
      level: "feature",
      status: "deferred",
      lastModified: STAMP,
      lastModifiedBy: OTHER_AUTHOR,
    } as PRDItem;

    beforeEach(async () => {
      await seed(epicFeatureTask([deferredSibling], "completed"));
      await agentClaimsCompletion();
      // The cascade closed the feature but could not reach the epic.
      expect((await get("feature-1")).status).toBe("completed");
      expect((await get("epic-1")).status).toBe("completed");
      expect((await get("epic-1")).completedAt).toBe(STAMP);
    });

    it("is reopened as well, because it now has a pending descendant", async () => {
      await finalizeWithLeakedWork();

      expect((await get("feature-1")).status).toBe("pending");
      expect((await get("epic-1")).status).toBe("pending");
      expect((await get("epic-1")).lastModifiedBy).toBe(OTHER_AUTHOR);
    });

    it("leaves the deferred sibling alone", async () => {
      await finalizeWithLeakedWork();

      expect((await get("feature-2")).status).toBe("deferred");
    });
  });
});
