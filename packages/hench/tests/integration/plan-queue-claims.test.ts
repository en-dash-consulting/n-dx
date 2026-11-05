/**
 * `hench run --plan-queue` passes over every task a live claim holds — this
 * worktree's own included. A run in this worktree claims its task, so a plan
 * that offered it would start a second run of the task already running.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdPlanQueue } from "../../src/cli/commands/plan-queue.js";
import type { QueuePlan } from "../../src/queue/plan-queue.js";
import { TaskClaims } from "../../src/process/task-claims.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { RM_RETRY } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";

let root: string;

async function plan(): Promise<QueuePlan> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await cmdPlanQueue(root, { format: "json" });
    return JSON.parse(String(log.mock.calls.at(-1)?.[0])) as QueuePlan;
  } finally {
    log.mockRestore();
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-plan-queue-claims-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await cp(FIXTURE, join(root, ".rex"), { recursive: true });
  await writeFile(join(root, ".rex", "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
  await mkdir(join(root, ".hench"));
  await writeFile(join(root, ".hench", "config.json"), JSON.stringify(DEFAULT_HENCH_CONFIG()));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, ...RM_RETRY });
});

describe("plan-queue and claims", () => {
  it("offers the unclaimed ready task", async () => {
    const p = await plan();
    expect(p.lanes.flatMap((l) => l.tasks.map((t) => t.id))).toEqual([WIRE_ID]);
  });

  it("does not offer a task this worktree's live run has claimed", async () => {
    const claims = TaskClaims.forProject(root);
    expect(await claims.claim(WIRE_ID)).toBeNull();
    const p = await plan();
    expect(p.lanes).toEqual([]);
    expect([...p.lanes.flatMap((l) => l.tasks), ...p.excluded].map((t) => t.id)).not.toContain(WIRE_ID);
  });
});
