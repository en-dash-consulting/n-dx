/**
 * `hench run --task=<deferred> --dry-run --reset-deferred` — the Prepare task
 * modal's brief preview of a deferred task.
 *
 * A real run resets the task to pending before selecting it. A dry run writes
 * nothing, so the brief is built as if the reset had happened: the task is
 * read as pending, and the PRD tree, claims file, hench state, git status and
 * HEAD are left as they were.
 *
 * @see packages/hench/src/cli/commands/run.ts — cmdRun's --reset-deferred step
 * @see packages/hench/src/agent/planning/brief.ts — AssembleBriefOptions.wouldResetIds
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cmdRun } from "../../src/cli/commands/run.js";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

const DOC = {
  schema: "rex/v1",
  title: "Preview",
  items: [
    {
      id: "epic-1",
      title: "Preview Epic",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        { id: "t-deferred", title: "Deferred task", level: "task" as const, status: "deferred" as const },
        { id: "t-blocked", title: "Blocked task", level: "task" as const, status: "blocked" as const },
      ],
    },
  ],
};

let projectDir: string;
let henchDir: string;
let rexDir: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: projectDir, encoding: "utf-8" }).trim();
}

async function snapshot(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(current: string, rel: string): Promise<void> {
    for (const entry of await readdir(current)) {
      const abs = join(current, entry);
      const key = rel ? `${rel}/${entry}` : entry;
      if ((await stat(abs)).isDirectory()) await walk(abs, key);
      else out.set(key, await readFile(abs, "utf-8"));
    }
  }
  await walk(dir, "");
  return out;
}

/** Everything cmdRun printed on stdout, uncoloured. */
async function dryRun(flags: Record<string, string>): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await cmdRun(projectDir, { ...flags, "dry-run": "true" });
    return log.mock.calls.map((c) => c.map(String).join(" ")).join("\n").replace(/\u001b\[[0-9;]*m/g, "");
  } finally {
    log.mockRestore();
  }
}

beforeEach(async () => {
  ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-dry-reset-"));
  await (await resolveStore(rexDir)).saveDocument(DOC as never);
  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({ llm: { vendor: "claude", claude: { cli_path: process.execPath } } }),
    "utf-8",
  );
  commitGitFixtureBaseline(projectDir);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("dry run with --reset-deferred over a deferred task", () => {
  it("builds the brief as if the task were pending, and writes nothing", async () => {
    const claimsFile = join(projectDir, ".git", "ndx", "claims.json");
    const before = {
      rex: await snapshot(rexDir),
      hench: await snapshot(henchDir),
      status: git("status", "--porcelain", "--untracked-files=all"),
      head: git("rev-parse", "HEAD"),
      claims: existsSync(claimsFile),
    };

    const out = await dryRun({ task: "t-deferred", "reset-deferred": "true", auto: "true" });

    expect(out).toContain("Deferred task");
    expect(out).toMatch(/Status:\s*pending/);
    expect(out).not.toMatch(/cannot be worked on/);

    expect(await snapshot(rexDir)).toEqual(before.rex);
    expect(await snapshot(henchDir)).toEqual(before.hench);
    expect(git("status", "--porcelain", "--untracked-files=all")).toBe(before.status);
    expect(git("rev-parse", "HEAD")).toBe(before.head);
    expect(existsSync(claimsFile)).toBe(before.claims);
  });

  it("still refuses the deferred task without --reset-deferred", async () => {
    await expect(dryRun({ task: "t-deferred", auto: "true" })).rejects.toThrow(/cannot be worked on/);
  });

  it("does not lift the refusal for a task the reset leaves alone", async () => {
    await expect(dryRun({ task: "t-blocked", "reset-deferred": "true", auto: "true" }))
      .rejects.toThrow(/cannot be worked on/);
  });
});
