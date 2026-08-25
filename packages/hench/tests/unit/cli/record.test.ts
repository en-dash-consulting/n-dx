import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { mockResolveActor, mockResolveHost } = vi.hoisted(() => ({
  mockResolveActor: vi.fn(async () => "Test Actor <test@example.com>"),
  mockResolveHost: vi.fn(() => "test-host"),
}));

// cmdRecord resolves actor/host via git config and os.hostname(); stub both
// so the assertions below don't depend on the machine running the tests.
vi.mock("../../../src/process/actor-identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/process/actor-identity.js")>();
  return {
    ...actual,
    resolveActor: mockResolveActor,
    resolveHost: mockResolveHost,
  };
});

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

  it("writes an assisted run record, with zero usage when there is no session", async () => {
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
    // Zeros because no Claude Code session is visible: tests/setup-session-env.js
    // clears CLAUDE_CODE_SESSION_ID, which Claude Code otherwise exports to every
    // tool it runs — including the test runner. Without that, this case picked up
    // the ambient session's real transcript and asserted against live numbers.
    // All four fields are present so the shape does not vary with the source.
    expect(run.tokenUsage).toEqual({
      input: 0,
      output: 0,
      cacheCreationInput: 0,
      cacheReadInput: 0,
    });
    expect(run.tokens?.total ?? 0).toBe(0);
    expect(run.actor).toBe("Test Actor <test@example.com>");
    expect(run.host).toBe("test-host");
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

  /**
   * Usage comes from the session transcript, so assisted runs stop reporting
   * zeros. Driven through `--transcript` rather than the ambient session: a
   * fixture is deterministic, and the live transcript grows between assertions.
   */
  describe("token usage from a transcript", () => {
    /** One assistant message, in the shape Claude Code writes. */
    function message(uuid: string, output: number, cacheRead = 0): string {
      return JSON.stringify({
        type: "assistant",
        uuid,
        message: {
          model: "claude-opus-5",
          usage: {
            input_tokens: 1,
            output_tokens: output,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: cacheRead,
          },
        },
      });
    }

    async function writeTranscript(name: string, lines: string[]): Promise<string> {
      const path = join(projectDir, name);
      await writeFile(path, lines.join("\n"), "utf-8");
      return path;
    }

    it("records the transcript's usage and takes its model", async () => {
      const transcript = await writeTranscript("t.jsonl", [
        message("a", 100, 5000),
        message("b", 50),
      ]);

      await cmdRecord(projectDir, { task: "T1", transcript, session: "s1" });

      const [run] = await listRuns(henchDir);
      expect(run.tokenUsage).toEqual({
        input: 2,
        output: 150,
        cacheCreationInput: 4,
        cacheReadInput: 5000,
      });
      // The model actually used, not the configured default.
      expect(run.model).toBe("claude-opus-5");
      // One usage-bearing message is one API call, which is what a turn counts.
      expect(run.turns).toBe(2);
      // saveRun derives the rollup tuple, which is what joins to the PRD item.
      expect(run.tokens?.total).toBe(2 + 150 + 4 + 5000);
    });

    it("claims only what is new when one session records twice", async () => {
      // The case this exists for: a single Claude Code session completing several
      // tasks. Without a watermark both records would claim the whole session.
      const first = await writeTranscript("t1.jsonl", [message("a", 100)]);
      await cmdRecord(projectDir, { task: "T1", transcript: first, session: "s1" });

      const second = await writeTranscript("t2.jsonl", [message("a", 100), message("b", 7)]);
      await cmdRecord(projectDir, { task: "T2", transcript: second, session: "s1" });

      const runs = await listRuns(henchDir);
      const byTask = Object.fromEntries(runs.map((r) => [r.taskId, r]));
      expect(byTask.T1.tokenUsage.output).toBe(100);
      expect(byTask.T2.tokenUsage.output).toBe(7);
    });

    it("keeps separate watermarks per session", async () => {
      const transcript = await writeTranscript("t.jsonl", [message("a", 100)]);

      await cmdRecord(projectDir, { task: "T1", transcript, session: "s1" });
      await cmdRecord(projectDir, { task: "T2", transcript, session: "s2" });

      // A different session has consumed nothing, so it sees the full file.
      const runs = await listRuns(henchDir);
      for (const run of runs) expect(run.tokenUsage.output).toBe(100);
    });

    it("records zero when nothing is new, rather than repeating the last delta", async () => {
      const transcript = await writeTranscript("t.jsonl", [message("a", 100)]);
      await cmdRecord(projectDir, { task: "T1", transcript, session: "s1" });
      await cmdRecord(projectDir, { task: "T2", transcript, session: "s1" });

      const [second] = (await listRuns(henchDir)).filter((r) => r.taskId === "T2");
      expect(second.tokenUsage.output).toBe(0);
      expect(second.turns).toBe(0);
    });

    it("prefers explicit token flags over the transcript", async () => {
      const transcript = await writeTranscript("t.jsonl", [message("a", 100)]);

      await cmdRecord(projectDir, {
        task: "T1",
        transcript,
        session: "s1",
        "output-tokens": "42",
        "input-tokens": "7",
      });

      const [run] = await listRuns(henchDir);
      expect(run.tokenUsage.output).toBe(42);
      expect(run.tokenUsage.input).toBe(7);
    });

    it("advances the watermark even when flags supplied the numbers", async () => {
      // Otherwise the next transcript-derived record would claim this spend too.
      const transcript = await writeTranscript("t.jsonl", [message("a", 100)]);
      await cmdRecord(projectDir, { task: "T1", transcript, session: "s1", "output-tokens": "42" });

      await cmdRecord(projectDir, { task: "T2", transcript, session: "s1" });

      const [second] = (await listRuns(henchDir)).filter((r) => r.taskId === "T2");
      expect(second.tokenUsage.output).toBe(0);
    });

    it("records without usage when --no-tokens is passed", async () => {
      const transcript = await writeTranscript("t.jsonl", [message("a", 100)]);

      await cmdRecord(projectDir, { task: "T1", transcript, session: "s1", "no-tokens": "true" });

      const [run] = await listRuns(henchDir);
      expect(run.tokenUsage.output).toBe(0);
      expect(run.model).toBe("claude-sonnet-4-6");
    });

    it("fails loudly for a named transcript it cannot read", async () => {
      // Silence about a file the caller asked for by name would look like a run
      // that genuinely cost nothing.
      await expect(
        cmdRecord(projectDir, { task: "T1", transcript: join(projectDir, "missing.jsonl") }),
      ).rejects.toThrow(/transcript/i);
    });

    it("still records when the session has no transcript to find", async () => {
      // A missing transcript must cost the tokens, never the record.
      await cmdRecord(projectDir, { task: "T1", session: "no-such-session" });

      const [run] = await listRuns(henchDir);
      expect(run.taskId).toBe("T1");
      expect(run.tokenUsage.output).toBe(0);
    });
  });

  /**
   * The usage window is what stops one record from claiming a whole session.
   * A malformed window must be an error (like --turns already is), and a
   * genuinely windowless first record must say what it is about to claim —
   * silence here once attributed 549 messages and 127M cache-read tokens,
   * four earlier tasks' spend included, to a single PRD item.
   */
  describe("usage window validation", () => {
    function message(uuid: string, output: number): string {
      return JSON.stringify({
        type: "assistant",
        uuid,
        message: {
          model: "claude-opus-5",
          usage: { input_tokens: 1, output_tokens: output },
        },
      });
    }

    it("rejects an unparseable --startedAt instead of silently claiming everything", async () => {
      // A locale-formatted date — exactly what a non-US `Get-Date` produces.
      await expect(
        cmdRecord(projectDir, { task: "T1", startedAt: "25/08/2026" }),
      ).rejects.toThrow(/--startedAt/);
    });

    it("rejects an unparseable --since the same way", async () => {
      await expect(
        cmdRecord(projectDir, { task: "T1", since: "not-a-time" }),
      ).rejects.toThrow(/--since/);
    });

    it("warns before a windowless first record claims a whole transcript", async () => {
      const transcript = join(projectDir, "windowless.jsonl");
      await writeFile(transcript, [message("a", 100), message("b", 50), message("c", 7)].join("\n"), "utf-8");

      await cmdRecord(projectDir, { task: "T1", transcript, session: "s-warn" });

      // The record is still written — the warning informs, it does not block.
      const [run] = await listRuns(henchDir);
      expect(run.tokenUsage.output).toBe(157);

      const warned = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(warned).toMatch(/3 usage-bearing messages/);
      expect(warned).toMatch(/--startedAt/);
    });

    it("does not warn when a window was given", async () => {
      const transcript = join(projectDir, "windowed.jsonl");
      await writeFile(transcript, [message("a", 100), message("b", 50)].join("\n"), "utf-8");

      await cmdRecord(projectDir, {
        task: "T1",
        transcript,
        session: "s-windowed",
        startedAt: "2026-08-25T00:00:00Z",
      });

      const warned = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(warned).not.toMatch(/usage-bearing messages/);
    });
  });
});
