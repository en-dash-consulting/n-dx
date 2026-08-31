import { describe, it, expect } from "vitest";
import { buildRunSummary } from "../../../src/agent/analysis/summary.js";
import type { ToolCallRecord } from "../../../src/schema/v1.js";

function call(
  tool: string,
  input: Record<string, unknown>,
  output = "ok",
  durationMs = 10,
): ToolCallRecord {
  return { turn: 1, tool, input, output, durationMs };
}

describe("buildRunSummary", () => {
  it("returns empty summary for no tool calls", () => {
    const summary = buildRunSummary([]);
    expect(summary.filesChanged).toEqual([]);
    expect(summary.filesRead).toEqual([]);
    expect(summary.commandsExecuted).toEqual([]);
    expect(summary.testsRun).toEqual([]);
  });

  /**
   * The Claude CLI reports its own tool names — Write, Edit, Read, Bash — not
   * hench's (write_file, read_file, run_command) or Codex's. That is the shape
   * every `ndx work` CLI-provider run records, and it went unrecognised: run
   * a4197298 persisted 19 tool calls including Bash, Read, Write and Edit and
   * still reported filesRead 0, commandsExecuted 0, testsRun 0.
   *
   * The path argument is `file_path`, not `path`.
   */
  describe("Claude CLI tool names", () => {
    it("tracks files written via Write and Edit", () => {
      const summary = buildRunSummary([
        call("Write", { file_path: "src/utils.js", content: "x" }),
        call("Edit", { file_path: "src/other.js", old_string: "a", new_string: "b" }),
      ]);
      expect(summary.filesChanged).toEqual(["src/other.js", "src/utils.js"]);
      expect(summary.counts.filesChanged).toBe(2);
    });

    it("tracks files read via Read", () => {
      const summary = buildRunSummary([call("Read", { file_path: "package.json" })]);
      expect(summary.filesRead).toEqual(["package.json"]);
      expect(summary.counts.filesRead).toBe(1);
    });

    it("tracks commands run via Bash, and recognises test commands among them", () => {
      const summary = buildRunSummary([
        call("Bash", { command: "ls -la" }),
        call("Bash", { command: "npm test" }),
      ]);
      expect(summary.counts.commandsExecuted).toBe(2);
      expect(summary.counts.testsRun).toBe(1);
      expect(summary.testsRun[0].command).toBe("npm test");
    });

    it("counts a multi-file edit once per file", () => {
      const summary = buildRunSummary([
        call("MultiEdit", { file_path: "src/a.ts", edits: [{}, {}] }),
      ]);
      expect(summary.filesChanged).toEqual(["src/a.ts"]);
    });

    it("does not double-count a file touched by both Write and git add", () => {
      const summary = buildRunSummary([
        call("Write", { file_path: "src/utils.js", content: "x" }),
        call("git", { subcommand: "add", args: "src/utils.js" }),
      ]);
      expect(summary.filesChanged).toEqual(["src/utils.js"]);
    });
  });

  it("tracks files written via write_file", () => {
    const calls = [
      call("write_file", { path: "src/foo.ts", content: "hello" }),
      call("write_file", { path: "src/bar.ts", content: "world" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual(["src/bar.ts", "src/foo.ts"]);
  });

  it("deduplicates files written multiple times", () => {
    const calls = [
      call("write_file", { path: "src/foo.ts", content: "v1" }),
      call("write_file", { path: "src/foo.ts", content: "v2" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual(["src/foo.ts"]);
  });

  it("deduplicates files written many times across turns", () => {
    const calls = [
      call("write_file", { path: "src/foo.ts", content: "v1" }),
      call("write_file", { path: "src/bar.ts", content: "v1" }),
      call("write_file", { path: "src/foo.ts", content: "v2" }),
      call("write_file", { path: "src/foo.ts", content: "v3" }),
      call("write_file", { path: "src/bar.ts", content: "v2" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual(["src/bar.ts", "src/foo.ts"]);
    expect(summary.counts.filesChanged).toBe(2);
  });

  it("deduplicates files changed via both write_file and git add", () => {
    const calls = [
      call("write_file", { path: "src/foo.ts", content: "new" }),
      call("git", { subcommand: "add", args: "src/foo.ts" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual(["src/foo.ts"]);
    expect(summary.counts.filesChanged).toBe(1);
  });

  it("tracks files read via read_file", () => {
    const calls = [
      call("read_file", { path: "src/foo.ts" }),
      call("read_file", { path: "src/bar.ts" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesRead).toEqual(["src/bar.ts", "src/foo.ts"]);
  });

  it("deduplicates files read multiple times", () => {
    const calls = [
      call("read_file", { path: "src/foo.ts" }),
      call("read_file", { path: "src/foo.ts" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesRead).toEqual(["src/foo.ts"]);
  });

  it("deduplicates files read many times across turns", () => {
    const calls = [
      call("read_file", { path: "src/foo.ts" }),
      call("read_file", { path: "src/bar.ts" }),
      call("read_file", { path: "src/foo.ts" }),
      call("read_file", { path: "src/baz.ts" }),
      call("read_file", { path: "src/bar.ts" }),
      call("read_file", { path: "src/foo.ts" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesRead).toEqual(["src/bar.ts", "src/baz.ts", "src/foo.ts"]);
    expect(summary.counts.filesRead).toBe(3);
  });

  it("tracks commands executed via run_command", () => {
    const calls = [
      call("run_command", { command: "npm test" }, "passed", 5000),
      call("run_command", { command: "npm run build" }, "ok", 3000),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.commandsExecuted).toHaveLength(2);
    expect(summary.commandsExecuted[0]).toEqual({
      command: "npm test",
      exitStatus: "ok",
      durationMs: 5000,
    });
    expect(summary.commandsExecuted[1]).toEqual({
      command: "npm run build",
      exitStatus: "ok",
      durationMs: 3000,
    });
  });

  it("detects failed commands from output", () => {
    const calls = [
      call("run_command", { command: "npm test" }, "[ERROR] exit code 1", 5000),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.commandsExecuted[0].exitStatus).toBe("error");
  });

  it("detects timed out commands", () => {
    const calls = [
      call("run_command", { command: "npm test" }, "Command timed out after 30000ms", 30000),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.commandsExecuted[0].exitStatus).toBe("timeout");
  });

  it("detects guarded commands", () => {
    const calls = [
      call("run_command", { command: "rm -rf /" }, "[GUARD] Command not allowed", 0),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.commandsExecuted[0].exitStatus).toBe("blocked");
  });

  it("tracks git commits via git tool", () => {
    const calls = [
      call("git", { subcommand: "add", args: "src/foo.ts" }),
      call("git", { subcommand: "commit", args: "-m 'fix bug'" }, "[main abc123] fix bug"),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual(["src/foo.ts"]);
    expect(summary.commandsExecuted).toHaveLength(2);
  });

  it("identifies test commands in run_command", () => {
    const calls = [
      call("run_command", { command: "npm test" }, "12 passed", 5000),
      call("run_command", { command: "vitest run" }, "5 passed", 3000),
      call("run_command", { command: "pnpm test" }, "ok", 2000),
      call("run_command", { command: "jest --ci" }, "Tests: 3 passed", 4000),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.testsRun).toHaveLength(4);
    expect(summary.testsRun[0]).toEqual({
      command: "npm test",
      passed: true,
      durationMs: 5000,
    });
  });

  it("detects failed test runs", () => {
    const calls = [
      call("run_command", { command: "npm test" }, "[ERROR] 2 tests failed", 5000),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.testsRun).toHaveLength(1);
    expect(summary.testsRun[0].passed).toBe(false);
  });

  it("tracks git add paths as files changed", () => {
    const calls = [
      call("git", { subcommand: "add", args: "." }),
    ];
    const summary = buildRunSummary(calls);
    // "." is not a specific file, so it should not be tracked
    expect(summary.filesChanged).toEqual([]);
  });

  it("tracks specific git add paths as files changed", () => {
    const calls = [
      call("git", { subcommand: "add", args: "src/foo.ts src/bar.ts" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual(["src/bar.ts", "src/foo.ts"]);
  });

  it("computes aggregate counts", () => {
    const calls = [
      call("read_file", { path: "src/a.ts" }),
      call("read_file", { path: "src/b.ts" }),
      call("write_file", { path: "src/a.ts", content: "new" }),
      call("write_file", { path: "src/c.ts", content: "new" }),
      call("run_command", { command: "npm test" }, "passed", 5000),
      call("run_command", { command: "npm run build" }, "ok", 3000),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.counts).toEqual({
      filesRead: 2,
      filesChanged: 2,
      commandsExecuted: 2,
      testsRun: 1,
      toolCallsTotal: 6,
    });
  });

  it("does not include read-only files in filesChanged", () => {
    const calls = [
      call("read_file", { path: "src/readonly.ts" }),
      call("write_file", { path: "src/changed.ts", content: "x" }),
    ];
    const summary = buildRunSummary(calls);
    expect(summary.filesChanged).toEqual(["src/changed.ts"]);
    expect(summary.filesRead).toEqual(["src/readonly.ts"]);
  });

  it("handles mixed tool calls correctly", () => {
    const calls = [
      call("read_file", { path: "src/foo.ts" }),
      call("list_directory", { path: "src/" }),
      call("search_files", { pattern: "hello", path: "src/" }),
      call("write_file", { path: "src/foo.ts", content: "updated" }),
      call("run_command", { command: "npm test" }, "ok", 1000),
      call("git", { subcommand: "status" }),
      call("git", { subcommand: "add", args: "src/foo.ts" }),
      call("git", { subcommand: "commit", args: "-m 'update'" }),
      call("rex_update_status", { status: "completed" }),
      call("rex_append_log", { event: "done" }),
    ];
    const summary = buildRunSummary(calls);

    expect(summary.filesRead).toEqual(["src/foo.ts"]);
    expect(summary.filesChanged).toEqual(["src/foo.ts"]);
    expect(summary.commandsExecuted).toHaveLength(4); // run_command + 3 git calls
    expect(summary.testsRun).toHaveLength(1);
    expect(summary.counts.toolCallsTotal).toBe(10);
  });
});
