/**
 * hench finds the PRD on a project moved to the `.ndx/` layout while its config
 * still holds `rexDir: ".rex"` — the schema default, which `ndx migrate-layout`
 * left unrewritten before it learned to. `ndx work --task`, `--resolve` (the
 * Sidecar preview) and `--plan-queue` all read the PRD through
 * `resolveHenchRexDir`, so the legacy default follows the layout while a
 * deliberate value still wins.
 *
 * @see packages/hench/src/store/paths.ts — resolveHenchRexDir
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdPlanQueue } from "../../src/cli/commands/plan-queue.js";
import { resolveRun } from "../../src/cli/commands/run-resolve.js";
import { cmdRun } from "../../src/cli/commands/run.js";
import type { QueuePlan } from "../../src/queue/plan-queue.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { cleanupProjectDir, commitGitFixtureBaseline } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";
const WIRE_TITLE = "Wire the button";

let root: string;

/** A `.ndx/` project whose PRD sits at `prdRel` and whose hench config names `rexDir`. */
async function setup(rexDir: string, prdRel: string): Promise<void> {
  await mkdir(join(root, ".ndx", "hench"), { recursive: true });
  await cp(FIXTURE, join(root, prdRel), { recursive: true });
  await writeFile(
    join(root, prdRel, "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }),
  );
  await writeFile(
    join(root, ".ndx", "hench", "config.json"),
    JSON.stringify({ ...DEFAULT_HENCH_CONFIG(), rexDir }),
  );
  await writeFile(join(root, ".ndx", "config.json"), JSON.stringify({ llm: { vendor: "claude" } }));
  // cli_path is machine-local: a shared one applies only once the repository is trusted.
  await writeFile(
    join(root, ".ndx", "config.local.json"),
    JSON.stringify({ llm: { claude: { cli_path: process.execPath } } }),
  );
  await writeFile(join(root, ".gitignore"), ".ndx/config.local.json\n");
  commitGitFixtureBaseline(root);
}

async function planQueueIds(): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await cmdPlanQueue(root, { format: "json" });
    const plan = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as QueuePlan;
    return plan.lanes.flatMap((l) => l.tasks.map((t) => t.id));
  } finally {
    log.mockRestore();
  }
}

async function dryRunOutput(flags: Record<string, string>): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await cmdRun(root, { ...flags, "dry-run": "true" });
    return log.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
  } finally {
    log.mockRestore();
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-ndx-rex-dir-"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(root);
});

describe("hench config rexDir '.rex' on the .ndx/ layout", () => {
  beforeEach(async () => {
    await setup(".rex", join(".ndx", "rex"));
  });

  it("--plan-queue offers the task from .ndx/rex", async () => {
    expect(await planQueueIds()).toEqual([WIRE_ID]);
  });

  it("--resolve finds the task", async () => {
    const resolution = await resolveRun(root, { task: WIRE_ID });
    expect(resolution.refusals.map((r) => r.code)).not.toContain("task-not-found");
    expect(resolution.task?.title).toBe(WIRE_TITLE);
  });

  it("--task finds the task", async () => {
    expect(await dryRunOutput({ task: WIRE_ID, auto: "true" })).toContain(WIRE_TITLE);
  });
});

describe("a deliberate rexDir on the .ndx/ layout", () => {
  it("still wins over the layout's rex dir", async () => {
    await setup("planning", "planning");
    expect(await planQueueIds()).toEqual([WIRE_ID]);
    expect((await resolveRun(root, { task: WIRE_ID })).task?.title).toBe(WIRE_TITLE);
  });
});
