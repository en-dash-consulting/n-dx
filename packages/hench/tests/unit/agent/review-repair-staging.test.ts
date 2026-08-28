/**
 * A repair the reviewer applies but never stages must still reach the commit.
 *
 * The run's commit is `git commit -F` — index only. The executor's `git add -A`
 * ran before the review pass, and the only post-review staging is the `.rex/`
 * PRD paths, so a must-fix repair the reviewer edits without running `git add`
 * is absent from the commit while the report records it as `fixed`. The dirty
 * repair then rides the next run's `git add -A` and is attributed to unrelated
 * work.
 *
 * Two defences, both asserted here: the reviewer prompt tells the reviewer to
 * stage what it fixes, and the run restages tracked modifications after a
 * review pass that reports `fixesApplied` — because an instruction in a prompt
 * is not enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { processSuccessfulResult } from "../../../src/agent/lifecycle/cli-loop.js";
import type { ReviewPassContext } from "../../../src/agent/lifecycle/cli-loop.js";
import { performCommitPromptIfNeeded } from "../../../src/agent/lifecycle/shared.js";
import { buildReviewBrief, reviewReportPath } from "../../../src/agent/analysis/adversarial-review.js";
import type { VendorAdapter, SpawnConfig } from "../../../src/agent/lifecycle/vendor-adapter.js";
import { DEFAULT_EXECUTION_POLICY } from "../../../src/prd/llm-gateway.js";
import type { PRDStore } from "../../../src/prd/rex-gateway.js";

const exec = promisify(execFile);

const RUN_ID = "run-review-staging";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

/** Adapter whose "reviewer" is the given node script. */
function stubAdapter(script: string): VendorAdapter {
  return {
    vendor: "claude",
    parseMode: "stream-json",
    buildSpawnConfig: (): SpawnConfig => ({
      binary: process.execPath,
      args: [script],
      env: {},
      stdinContent: null,
    }),
    parseEvent: () => null,
    classifyError: () => "unknown",
  } as unknown as VendorAdapter;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runRecord(): any {
  return {
    id: RUN_ID,
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: "in_progress",
    turns: 0,
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "claude-sonnet-4-6",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spawnResult(): any {
  return {
    turns: 3,
    toolCalls: [{ name: "Bash", input: "echo", timestamp: new Date().toISOString() }],
    tokenUsage: { input: 10, output: 10 },
    turnTokenUsage: [],
    summary: "did the work",
  };
}

describe("review-pass repairs are staged before the run commits", () => {
  let projectDir: string;
  let henchDir: string;
  let reviewerScript: string;
  let reportPath: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-review-staging-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(henchDir, { recursive: true });
    reportPath = reviewReportPath(henchDir, RUN_ID);

    await git(projectDir, "init", "-q");
    await git(projectDir, "config", "user.email", "test@test.invalid");
    await git(projectDir, "config", "user.name", "Test");
    await writeFile(join(projectDir, "a.txt"), "base\n", "utf-8");
    await git(projectDir, "add", "-A");
    await git(projectDir, "commit", "-q", "-m", "base");

    // The executor's end-of-turn state: staged work + proposed message.
    await writeFile(join(projectDir, "a.txt"), "changed by executor\n", "utf-8");
    await git(projectDir, "add", "-A");
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: executor work\n", "utf-8");

    reviewerScript = join(projectDir, "reviewer.cjs");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  /**
   * A reviewer that repairs a tracked file and reports the repair, but never
   * runs `git add` — the failure mode the restaging exists to cover.
   */
  async function writeReviewer(fixesApplied: boolean): Promise<void> {
    const report = {
      taskId: "task-1",
      fixesApplied,
      summary: "attacked the change",
      findings: [
        {
          title: "Off-by-one in the loop bound",
          location: "a.txt:1",
          severity: "high",
          verdict: "must-fix",
          scenario: "input of length n skips the last element",
          action: "fixed",
        },
      ],
    };
    await writeFile(
      reviewerScript,
      [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(join(projectDir, "a.txt"))}, 'changed by executor\\nreview repair\\n');`,
        `fs.mkdirSync(require('node:path').dirname(${JSON.stringify(reportPath)}), { recursive: true });`,
        `fs.writeFileSync(${JSON.stringify(reportPath)}, ${JSON.stringify(JSON.stringify(report))});`,
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  function reviewPass(): ReviewPassContext {
    return {
      adapter: stubAdapter(reviewerScript),
      vendor: "claude",
      cliBinary: process.execPath,
      policy: DEFAULT_EXECUTION_POLICY,
      henchDir,
      reviewModel: "",
      permissionMode: "acceptEdits",
      autonomous: true,
      taskTitle: "Test task",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function runPass(run: any): Promise<string> {
    return processSuccessfulResult({
      run,
      result: spawnResult(),
      accumulated: {
        turns: 3,
        toolCalls: [],
        turnTokenUsage: [],
        tokenUsage: { input: 10, output: 10 },
      },
      attempt: 0,
      store: {} as PRDStore,
      taskId: "task-1",
      projectDir,
      startingHead: undefined,
      reviewPass: reviewPass(),
    });
  }

  it("includes an unstaged reviewer repair in the run's commit", async () => {
    await writeReviewer(true);

    const run = runRecord();
    expect(await runPass(run)).toBe("break");
    expect(run.status).toBe("completed");

    // Restaged before the commit prompt, not left dirty for the next run.
    expect(await git(projectDir, "diff", "--name-only")).toBe("");
    expect(await git(projectDir, "diff", "--cached", "--name-only")).toContain("a.txt");

    await performCommitPromptIfNeeded(run, projectDir, false, true, true, undefined, "task-1");

    expect(await git(projectDir, "rev-list", "--count", "HEAD")).toBe("2");
    // The repair itself is in the commit, not merely reported as applied.
    expect(await git(projectDir, "show", "HEAD:a.txt")).toContain("review repair");
    expect(await git(projectDir, "status", "--porcelain", "a.txt")).toBe("");
  }, 20_000);

  it("leaves the index alone when the review reports no fixes", async () => {
    // Report says nothing was fixed; the executor's staged work is all there is.
    await writeFile(
      reviewerScript,
      [
        "const fs = require('node:fs');",
        `fs.mkdirSync(require('node:path').dirname(${JSON.stringify(reportPath)}), { recursive: true });`,
        `fs.writeFileSync(${JSON.stringify(reportPath)}, ${JSON.stringify(
          JSON.stringify({ taskId: "task-1", fixesApplied: false, summary: "clean", findings: [] }),
        )});`,
        "",
      ].join("\n"),
      "utf-8",
    );

    const run = runRecord();
    expect(await runPass(run)).toBe("break");

    await performCommitPromptIfNeeded(run, projectDir, false, true, true, undefined, "task-1");
    expect(await git(projectDir, "show", "HEAD:a.txt")).toBe("changed by executor");
  }, 20_000);
});

describe("reviewer prompt", () => {
  it("instructs the reviewer to stage every file it fixes", () => {
    const brief = buildReviewBrief({
      taskId: "task-1",
      taskTitle: "Test task",
      startingHead: "abc123",
      reportPath: "/tmp/report.json",
      resumed: false,
      autonomous: true,
    });

    expect(brief).toMatch(/git add/);
    expect(brief.toLowerCase()).toContain("stage every file you fix");
  });
});
