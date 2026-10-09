/**
 * Agent-written work commits carry the task's N-DX-Item.
 *
 * On the autoCommit path the agent commits its own work and hench adds no
 * trailers, so the brief has to hand the agent the exact lines — and a run
 * whose commits still lack them has to say so. Trailers are read through
 * git's own parser (`%(trailers:key=N-DX-Item,valueonly)`), never a regex.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/index.js";
import type { RunRecord, TaskBrief } from "../../src/schema/index.js";
import {
  briefForRun,
  buildAgentCommitTrailers,
  findCommitsMissingItem,
  finalizeRun,
} from "../../src/agent/lifecycle/shared.js";
import { buildSystemPrompt } from "../../src/agent/planning/prompt.js";
import { formatCommitsMissingItem } from "../../src/cli/commands/run.js";
import { initGitFixtureRepo, cleanupProjectDir } from "../helpers/index.js";

const TASK = "80bf4e58-task";
const CONFIG = DEFAULT_HENCH_CONFIG();

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function brief(): TaskBrief {
  return {
    task: { id: TASK, title: "Agent commit trailers", level: "task", status: "in_progress" },
    parentChain: [],
    siblings: [],
    requirements: [],
    project: { name: "fixture", cliName: "n-dx" },
    workflow: "",
    recentLog: [],
  };
}

describe("the brief names the run's commit trailers", () => {
  const run = { id: "run-123", taskId: TASK, vendor: "claude", model: "claude-opus-5-5", weight: "standard" } as const;

  it("gives the exact N-DX and N-DX-Item lines and asks for one final block", () => {
    const { briefText, envelope } = briefForRun(brief(), run, CONFIG);

    expect(buildAgentCommitTrailers(run)).toEqual([
      "N-DX: claude/claude-opus-5-5 · run run-123",
      `N-DX-Item: ${TASK}`,
    ]);
    expect(briefText).toContain("## Commit Trailers");
    expect(briefText).toContain("N-DX: claude/claude-opus-5-5 · run run-123\nN-DX-Item: " + TASK);
    expect(briefText).toMatch(/one final trailer block/);
    // hench's own co-author is not the agent's to write.
    expect(briefText).not.toContain("En Dash's n-dx");

    const sent = envelope.sections.find((s) => s.name === "brief")?.content;
    expect(sent).toBe(briefText);
  });

  it("keeps the task id out of the system prompt", () => {
    const { envelope } = briefForRun(brief(), run, CONFIG);
    const system = envelope.sections.find((s) => s.name === "system")?.content ?? "";
    expect(system).toBe(buildSystemPrompt(brief().project, CONFIG));
    expect(system).not.toContain(TASK);
    expect(system).not.toContain("N-DX-Item");
  });
});

describe("finalizeRun reports commits git cannot tie to the task", () => {
  let projectDir: string;
  let henchDir: string;
  let baseline: string;

  beforeEach(async () => {
    projectDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-item-trailer-")));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    await initGitFixtureRepo(projectDir);
    await writeFile(join(projectDir, ".gitignore"), ".hench/\n.run-logs/\n");
    await writeFile(join(projectDir, "a.ts"), "export const a = 0;\n");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-q", "-m", "baseline");
    baseline = git(projectDir, "rev-parse", "HEAD").trim();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  function buildRun(): RunRecord {
    return {
      id: randomUUID(),
      taskId: TASK,
      taskTitle: "Agent commit trailers",
      startedAt: new Date().toISOString(),
      status: "completed",
      turns: 1,
      tokenUsage: { input: 0, output: 0 },
      turnTokenUsage: [],
      toolCalls: [],
      model: "test-model",
      startHead: baseline,
    };
  }

  function commit(value: number, message: string): string {
    execFileSync("node", ["-e", `require("fs").writeFileSync("a.ts", "export const a = ${value};\\n")`], { cwd: projectDir });
    git(projectDir, "add", "a.ts");
    git(projectDir, "commit", "-q", "-m", message);
    return git(projectDir, "rev-parse", "HEAD").trim();
  }

  it("records and prints a commit with no N-DX-Item, without touching it", async () => {
    const tagged = commit(1, `feat: tagged\n\nN-DX-Item: ${TASK}\nCo-Authored-By: Claude <noreply@anthropic.com>`);
    const bare = commit(2, "feat: untagged\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    // Split off by a blank line: body text to git, so not a trailer.
    const split = commit(3, `feat: split\n\nN-DX-Item: ${TASK}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`);
    const other = commit(4, "feat: other item\n\nN-DX-Item: some-other-task");
    const head = git(projectDir, "rev-parse", "HEAD").trim();

    const run = buildRun();
    await finalizeRun({ run, henchDir, projectDir });

    expect(run.commits?.map((c) => c.sha)).toEqual([tagged, bare, split, other]);
    expect(run.commitsMissingItem).toEqual([
      { sha: bare, subject: "feat: untagged", items: [] },
      { sha: split, subject: "feat: split", items: [] },
      { sha: other, subject: "feat: other item", items: ["some-other-task"] },
    ]);

    const lines = formatCommitsMissingItem(run);
    expect(lines[0]).toContain(`3 commits not tied to this task (no \`N-DX-Item: ${TASK}\``);
    expect(lines.slice(1)).toEqual([
      `  ${bare.slice(0, 9)} feat: untagged`,
      `  ${split.slice(0, 9)} feat: split`,
      `  ${other.slice(0, 9)} feat: other item (N-DX-Item: some-other-task)`,
    ]);

    // Reported, never amended or rewritten.
    expect(git(projectDir, "rev-parse", "HEAD").trim()).toBe(head);
  });

  it("records nothing when every commit carries the task id", async () => {
    commit(1, `feat: one\n\nN-DX: claude/x · run r\nN-DX-Item: ${TASK}`);
    commit(2, `feat: two\n\nN-DX-Item: ${TASK}\nN-DX-Item: another-task`);

    const run = buildRun();
    await finalizeRun({ run, henchDir, projectDir });

    expect(run.commits).toHaveLength(2);
    expect(run.commitsMissingItem).toBeUndefined();
    expect(formatCommitsMissingItem(run)).toEqual([]);
  });

  it("findCommitsMissingItem keeps each commit's items apart across several commits", async () => {
    const ok = commit(1, `feat: ok\n\nN-DX-Item: ${TASK}`);
    const many = commit(2, "feat: many\n\nN-DX-Item: x-1\nN-DX-Item: x-2");
    const none = commit(3, "feat: none");
    const refs = [ok, many, none].map((sha) => ({ sha, subject: "s" }));

    expect(await findCommitsMissingItem(projectDir, refs, TASK)).toEqual([
      { sha: many, subject: "s", items: ["x-1", "x-2"] },
      { sha: none, subject: "s", items: [] },
    ]);
  });

  it("findCommitsMissingItem says nothing for commits it cannot read", async () => {
    const refs = [{ sha: "0".repeat(40), subject: "gone" }];
    expect(await findCommitsMissingItem(projectDir, refs, TASK)).toEqual([]);
  });
});
