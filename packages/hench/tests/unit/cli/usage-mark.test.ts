import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdUsage } from "../../../src/cli/commands/usage.js";
import { loadUsageCursor } from "../../../src/store/session-usage.js";

/**
 * `hench usage mark` — the start-of-task snapshot the skills take instead of
 * typing a timestamp. Driven through `--transcript` for determinism.
 */
describe("hench usage mark", () => {
  let projectDir: string;
  let henchDir: string;

  function message(uuid: string, output: number, cacheRead = 0): string {
    return JSON.stringify({
      type: "assistant",
      uuid,
      message: {
        model: "claude-opus-5",
        usage: { input_tokens: 1, output_tokens: output, cache_creation_input_tokens: 2, cache_read_input_tokens: cacheRead },
      },
    });
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-usage-mark-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("writes a mark holding the transcript's position and cumulative totals", async () => {
    const transcript = join(projectDir, "t.jsonl");
    await writeFile(transcript, [message("a", 100, 5000), message("b", 50)].join("\n"), "utf-8");

    await cmdUsage(projectDir, ["mark"], { task: "T1", transcript, session: "s1" });

    const cursor = await loadUsageCursor(henchDir, "s1");
    expect(cursor.marks?.T1).toMatchObject({
      task: "T1",
      lastUuid: "b",
      consumed: 2,
      totals: { input: 2, output: 150, cacheCreationInput: 4, cacheReadInput: 5000 },
    });
    expect(Date.parse(cursor.marks!.T1.at)).not.toBeNaN();
    // The watermark itself is untouched — marking is not recording.
    expect(cursor.consumed).toBe(0);
  });

  it("re-marking the same task overwrites; marking another task adds", async () => {
    const transcript = join(projectDir, "t.jsonl");
    await writeFile(transcript, [message("a", 100)].join("\n"), "utf-8");
    await cmdUsage(projectDir, ["mark"], { task: "T1", transcript, session: "s1" });

    await writeFile(transcript, [message("a", 100), message("b", 7)].join("\n"), "utf-8");
    await cmdUsage(projectDir, ["mark"], { task: "T1", transcript, session: "s1" });
    await cmdUsage(projectDir, ["mark"], { task: "skill:ndx-plan", transcript, session: "s1" });

    const cursor = await loadUsageCursor(henchDir, "s1");
    expect(Object.keys(cursor.marks!).sort()).toEqual(["T1", "skill:ndx-plan"]);
    expect(cursor.marks!.T1.consumed).toBe(2);
    expect(cursor.marks!.T1.lastUuid).toBe("b");
  });

  it("marks nothing, without failing, when there is no session to read", async () => {
    await cmdUsage(projectDir, ["mark"], { task: "T1" });
    const warned = vi.mocked(console.error).mock.calls.flat().join("\n");
    expect(warned).toMatch(/nothing marked/i);
    await expect(readFile(join(henchDir, "usage-cursors", "s1.json"), "utf-8")).rejects.toThrow();
  });

  it("requires --task and a known subcommand", async () => {
    await expect(cmdUsage(projectDir, ["mark"], { session: "s1" })).rejects.toThrow(/--task/);
    await expect(cmdUsage(projectDir, ["nope"], {})).rejects.toThrow(/subcommand/i);
    await expect(cmdUsage(projectDir, [], {})).rejects.toThrow(/subcommand/i);
  });

  it("lists pending marks", async () => {
    const transcript = join(projectDir, "t.jsonl");
    await writeFile(transcript, message("a", 1), "utf-8");
    await cmdUsage(projectDir, ["mark"], { task: "T1", transcript, session: "s1" });

    await cmdUsage(projectDir, ["marks"], { session: "s1", format: "json" });
    const printed = vi.mocked(console.log).mock.calls.flat().join("\n");
    const parsed = JSON.parse(printed.slice(printed.indexOf("{")));
    expect(parsed.marks.map((m: { task: string }) => m.task)).toEqual(["T1"]);
  });
});
