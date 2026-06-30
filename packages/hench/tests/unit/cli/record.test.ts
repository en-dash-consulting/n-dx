import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { cmdRecord } from "../../../src/cli/commands/record.js";
import { listRuns } from "../../../src/store/runs.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/index.js";

/**
 * `hench record` writes an assisted run record so /ndx-work task execution is
 * visible in run history (issue #271). These tests exercise the command
 * directly against a temp .hench/ directory.
 */
describe("hench record", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-record-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
    const config = DEFAULT_HENCH_CONFIG();
    config.model = "claude-sonnet-4-6";
    await writeFile(
      join(henchDir, "config.json"),
      JSON.stringify(config),
      "utf-8",
    );
    // Silence command output during tests.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("writes an assisted run record with zero token usage", async () => {
    await cmdRecord(projectDir, {
      task: "EPIC.F1.T2",
      title: "Implement login",
      status: "completed",
      summary: "Added auth flow",
    });

    const runs = await listRuns(henchDir);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.taskId).toBe("EPIC.F1.T2");
    expect(run.taskTitle).toBe("Implement login");
    expect(run.status).toBe("completed");
    expect(run.summary).toBe("Added auth flow");
    expect(run.assisted).toBe(true);
    expect(run.model).toBe("claude-sonnet-4-6");
    // Token usage is intentionally empty — Claude Code does not expose its own
    // usage to the skill, so the record must not fabricate token totals.
    expect(run.tokenUsage).toEqual({ input: 0, output: 0 });
    expect(run.tokens?.total ?? 0).toBe(0);
  });

  it("defaults status to completed and title to the task id", async () => {
    await cmdRecord(projectDir, { task: "T9" });

    const [run] = await listRuns(henchDir);
    expect(run.status).toBe("completed");
    expect(run.taskTitle).toBe("T9");
    expect(run.assisted).toBe(true);
  });

  it("accepts a non-completed status", async () => {
    await cmdRecord(projectDir, { task: "T9", status: "cancelled" });

    const [run] = await listRuns(henchDir);
    expect(run.status).toBe("cancelled");
  });

  it("throws when --task is missing", async () => {
    await expect(cmdRecord(projectDir, {})).rejects.toThrow(/task/i);
  });

  it("throws on an invalid --status", async () => {
    await expect(
      cmdRecord(projectDir, { task: "T1", status: "done" }),
    ).rejects.toThrow(/status/i);
  });

  it("throws on a negative --turns", async () => {
    await expect(
      cmdRecord(projectDir, { task: "T1", turns: "-3" }),
    ).rejects.toThrow(/turns/i);
  });
});
