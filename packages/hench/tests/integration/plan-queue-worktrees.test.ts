/**
 * `hench run --plan-queue` counts live runs in every worktree of the
 * repository, not only its own: lanes started here share the machine with
 * runs in sibling worktrees. The count reads lock files and writes nothing,
 * in any worktree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { cmdPlanQueue } from "../../src/cli/commands/plan-queue.js";
import type { QueuePlan } from "../../src/queue/plan-queue.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";
import { RM_RETRY } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");

let base: string;
let main: string;
let sibling: string;
let bare: string;

async function plan(dir: string): Promise<QueuePlan> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await cmdPlanQueue(dir, { format: "json" });
    return JSON.parse(String(log.mock.calls.at(-1)?.[0])) as QueuePlan;
  } finally {
    log.mockRestore();
  }
}

/** Every directory and file under `dir`, with file contents, so any write or mkdir shows. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        out[`${relative(dir, p)}/`] = "";
        await walk(p);
      } else {
        out[relative(dir, p)] = await readFile(p, "utf-8");
      }
    }
  };
  await walk(dir);
  return out;
}

async function seedProject(dir: string): Promise<void> {
  await cp(FIXTURE, join(dir, ".rex"), { recursive: true });
  await writeFile(join(dir, ".rex", "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
  await mkdir(join(dir, ".hench"));
  await writeFile(join(dir, ".hench", "config.json"), JSON.stringify(DEFAULT_HENCH_CONFIG()));
}

const git = (cwd: string, ...args: string[]): void => {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdio: "ignore" });
};

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "hench-plan-queue-worktrees-")));
  main = join(base, "main");
  sibling = join(base, "sibling");
  bare = join(base, "no-hench");
  await mkdir(main);
  git(main, "init", "--quiet");
  await seedProject(main);
  git(main, "add", "-A");
  git(main, "commit", "--quiet", "-m", "seed");
  git(main, "worktree", "add", "--quiet", sibling);
  git(main, "worktree", "add", "--quiet", bare);
  await rm(join(bare, ".hench"), { recursive: true, force: true, ...RM_RETRY });
  // A live run in the sibling: a lock naming this (live) process.
  await mkdir(join(sibling, ".hench", "locks"), { recursive: true });
  await writeFile(
    join(sibling, ".hench", "locks", `${process.pid}.lock`),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
  );
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true, ...RM_RETRY });
});

describe("plan-queue across worktrees", () => {
  it("counts a live run in a sibling worktree and reports the split", async () => {
    const p = await plan(main);
    expect(p.activeRuns).toBe(1);
    expect(p.activeRunsByWorktree).toEqual(
      expect.arrayContaining([
        { path: main, runs: 0 },
        { path: sibling, runs: 1 },
        { path: bare, runs: 0 },
      ]),
    );
    expect(p.activeRunsByWorktree).toHaveLength(3);
    expect(p.summary).toMatch(/1 live run in other worktrees\./);
  });

  it("counts this worktree's own live run too", async () => {
    const p = await plan(sibling);
    expect(p.activeRuns).toBe(1);
    expect(p.summary).toMatch(/0 live runs in other worktrees\./);
  });

  it("does not count its own worktree twice when given a differently cased path", async (ctx) => {
    const upper = sibling.toUpperCase();
    if (upper === sibling || !existsSync(upper)) ctx.skip(); // Case-sensitive filesystem.
    const p = await plan(upper);
    expect(p.activeRuns).toBe(1);
    expect(p.activeRunsByWorktree).toHaveLength(3);
    expect(p.summary).toMatch(/0 live runs in other worktrees\./);
  });

  it("creates and removes nothing in any worktree", async () => {
    // A stale lock the run limiter would clean up must survive the plan.
    await writeFile(join(sibling, ".hench", "locks", "999999999.lock"), JSON.stringify({ pid: 999999999, startedAt: "x" }));
    const before = await Promise.all([main, sibling, bare].map(snapshot));
    await plan(main);
    expect(await Promise.all([main, sibling, bare].map(snapshot))).toEqual(before);
  });

  it("outside a git repository, counts this directory alone and says so", async () => {
    const lone = join(base, "lone");
    await mkdir(lone);
    await seedProject(lone);
    // Keep git from finding an enclosing repository above the temp dir.
    vi.stubEnv("GIT_CEILING_DIRECTORIES", base);
    try {
      const p = await plan(lone);
      expect(p.activeRunsByWorktree).toEqual([{ path: lone, runs: 0 }]);
      expect(p.summary).toMatch(/counted in this worktree only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
