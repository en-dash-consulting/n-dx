import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hasUnfinishedWork,
  formatBackgroundWaitFailure,
  buildReviewResumeMessage,
  WORK_SESSION_RESUME_MESSAGE,
} from "../../../../src/agent/lifecycle/background-wait.js";
import { claudeCliAdapter } from "../../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import { codexCliAdapter } from "../../../../src/agent/lifecycle/adapters/codex-cli-adapter.js";

const detectBackgroundWait = (tool: string, input: Record<string, unknown> | undefined) =>
  claudeCliAdapter.detectBackgroundWait!({ tool, input });

describe("claude adapter: detectBackgroundWait", () => {
  it("fires on a Bash call with run_in_background: true, naming the command", () => {
    expect(detectBackgroundWait("Bash", { command: "pnpm test", run_in_background: true })).toEqual({
      tool: "Bash",
      detail: "pnpm test",
    });
  });

  it.each([
    ["absent", { command: "pnpm test" }],
    ["false", { command: "pnpm test", run_in_background: false }],
    // The CLI honours a boolean; a string is not what backgrounds the command.
    ["a string", { command: "pnpm test", run_in_background: "true" }],
  ])("does not fire on a Bash call with run_in_background %s", (_label, input) => {
    expect(detectBackgroundWait("Bash", input)).toBeUndefined();
  });

  it.each(["ScheduleWakeup", "Monitor"])("fires on any %s call", (tool) => {
    expect(detectBackgroundWait(tool, {})).toEqual({ tool, detail: "" });
    expect(detectBackgroundWait(tool, undefined)).toEqual({ tool, detail: "" });
  });

  it("carries a ScheduleWakeup reason as its detail", () => {
    expect(detectBackgroundWait("ScheduleWakeup", { delaySeconds: 300, reason: "suite" })?.detail).toBe("suite");
  });

  it("ignores polling a background job's output — that is the agent still working", () => {
    expect(detectBackgroundWait("BashOutput", { bash_id: "b1" })).toBeUndefined();
    expect(detectBackgroundWait("Read", { run_in_background: true })).toBeUndefined();
  });

  it("bounds the detail so a long command cannot flood the run record", () => {
    const signal = detectBackgroundWait("Bash", { command: "x".repeat(1000), run_in_background: true });
    expect(signal!.detail.length).toBe(120);
  });
});

describe("codex adapter: background waits and resume", () => {
  it("never reports a background wait, including a shell command backgrounded with &", () => {
    expect(codexCliAdapter.detectBackgroundWait!({ tool: "shell", input: { command: "pnpm test &" } }))
      .toBeUndefined();
    expect(codexCliAdapter.detectBackgroundWait!({ tool: "Bash", input: { run_in_background: true } }))
      .toBeUndefined();
  });

  it("supports bounded unfinished-session resume for both CLI adapters", () => {
    expect(codexCliAdapter.resumesUnfinishedSessions).toBe(true);
    expect(claudeCliAdapter.resumesUnfinishedSessions).toBe(true);
  });
});

describe("resume and failure messages", () => {
  it("tells the work session nothing will notify it, and what finishing means", () => {
    expect(WORK_SESSION_RESUME_MESSAGE).toMatch(/Nothing will notify you/);
    expect(WORK_SESSION_RESUME_MESSAGE).toMatch(/in the foreground/);
    expect(WORK_SESSION_RESUME_MESSAGE).toMatch(/commit/);
  });

  it("gives the reviewer the exact report path", () => {
    expect(buildReviewResumeMessage("/p/.hench/reviews/r.json")).toContain("    /p/.hench/reviews/r.json");
  });

  it("names the call behind a second background wait", () => {
    const message = formatBackgroundWaitFailure({ tool: "Monitor", detail: "" });
    expect(message).toMatch(/again after being resumed/);
    expect(message).toContain("last: Monitor)");
  });
});

describe("hasUnfinishedWork", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-unfinished-"));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  const listing = (lines: string[]) => async () => lines;

  it("is false on a clean tree", async () => {
    expect(await hasUnfinishedWork({ projectDir, autoCommit: true, listDirty: listing([]) })).toBe(false);
  });

  it("is true while the task's own files are uncommitted", async () => {
    expect(
      await hasUnfinishedWork({ projectDir, autoCommit: true, listDirty: listing(["?? src/feature.ts"]) }),
    ).toBe(true);
  });

  it("discounts the PRD paths and hench's runtime artifacts, which later steps own", async () => {
    const lines = [" M .rex/prd_tree/epic/task/index.md", "?? .hench/runs/abc.json"];
    expect(await hasUnfinishedWork({ projectDir, autoCommit: true, listDirty: listing(lines) })).toBe(false);
  });

  it("discounts staged work only when the commit prompt will commit it", async () => {
    const staged = listing(["A  src/feature.ts"]);

    // autoCommit: the agent should have committed; staged work has no owner.
    expect(await hasUnfinishedWork({ projectDir, autoCommit: true, listDirty: staged })).toBe(true);
    // Commit-prompt path without a message file: nothing will commit it either.
    expect(await hasUnfinishedWork({ projectDir, autoCommit: false, listDirty: staged })).toBe(true);

    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: the feature\n", "utf-8");
    expect(await hasUnfinishedWork({ projectDir, autoCommit: false, listDirty: staged })).toBe(false);
  });
});


describe("Codex structured unfinished stream", () => {
  it("tracks command completion by id without interpreting shell text", () => {
    const tracker = codexCliAdapter.createUnfinishedSessionTracker!();
    tracker.observe({ type: "item.started", item: { id: "a", type: "command_execution", status: "in_progress", command: "echo 'a&b'" } });
    tracker.observe({ type: "item.started", item: { id: "b", type: "command_execution", status: "in_progress" } });
    tracker.observe({ type: "item.completed", item: { id: "a", type: "command_execution", status: "completed" } });
    expect(tracker.signal()?.tool).toBe("command_execution");
    tracker.observe({ type: "item.completed", item: { id: "b", type: "command_execution", status: "failed" } });
    expect(tracker.signal()).toBeUndefined();
  });

  it.each(["turn.failed", "error"])("never recovers a %s stream as successful unfinished work", (type) => {
    const tracker = codexCliAdapter.createUnfinishedSessionTracker!();
    tracker.observe({ type: "turn.started" });
    tracker.observe({ type });
    expect(tracker.signal()).toBeUndefined();
  });

  it("clears an open turn only on its terminal event and keeps spawns independent", () => {
    const tracker = codexCliAdapter.createUnfinishedSessionTracker!();
    tracker.observe({ type: "turn.started" });
    expect(tracker.signal()?.tool).toBe("turn.started");
    expect(codexCliAdapter.createUnfinishedSessionTracker!().signal()).toBeUndefined();
    tracker.observe({ type: "turn.completed" });
    expect(tracker.signal()).toBeUndefined();
  });

  it("ignores unknown events and text promising to wait", () => {
    const tracker = codexCliAdapter.createUnfinishedSessionTracker!();
    for (const event of [null, "waiting", { type: "unknown" }, { type: "item.completed", item: { type: "agent_message", text: "I will wait for pnpm test &" } }]) tracker.observe(event);
    expect(tracker.signal()).toBeUndefined();
  });
});
