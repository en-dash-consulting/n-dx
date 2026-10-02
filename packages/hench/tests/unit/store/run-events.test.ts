import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyFileTool,
  closeActiveRunEvents,
  emitRunEvent,
  flushFileReads,
  openRunEvents,
  recordFileRead,
  recordFileWork,
  runEventsPath,
  setActiveRunEvents,
  summariseFileEdit,
  type RunEvent,
  type RunEventWriter,
} from "../../../src/store/run-events.js";

/**
 * Read and parse the whole file. No waiting: callers either close the writer
 * first — `close()` flushes, so the result is then final — or go through
 * {@link eventsWhenSettled}, which retries the assertion rather than sleeping
 * for a window and hoping. A bare sleep here would make a loaded machine, not
 * the code, decide the verdict.
 */
async function eventsIn(path: string): Promise<RunEvent[]> {
  return (await readFile(path, "utf-8"))
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as RunEvent);
}

/**
 * Wait for the file to hold `count` events, retrying the read.
 *
 * Used only where the point under test is that the events are readable *while
 * the writer is still open* — the whole reason this file is JSON Lines.
 */
async function eventsWhenSettled(path: string, count: number): Promise<RunEvent[]> {
  return vi.waitFor(async () => {
    const events = await eventsIn(path);
    expect(events.length).toBeGreaterThanOrEqual(count);
    return events;
  });
}

describe("runEventsPath", () => {
  it("places the file beside the run record under .hench/runs/", () => {
    const path = runEventsPath("/tmp/proj/.hench", "abc123");
    expect(path.endsWith(join("runs", "abc123.events.jsonl"))).toBe(true);
  });

  it("returns an absolute path, since another process reads it", () => {
    expect(isAbsolute(runEventsPath(".hench", "abc123"))).toBe(true);
  });

  it("does not collide with the run record's own .json suffix", () => {
    // listRuns() collects ids from files ending in `.json`; `.jsonl` must not
    // be mistaken for one, or every run would gain a phantom sibling.
    expect(runEventsPath(".hench", "abc123").endsWith(".json")).toBe(false);
  });
});

describe("openRunEvents", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-runevents-"));
  });

  afterEach(async () => {
    await closeActiveRunEvents();
    await rm(henchDir, { recursive: true, force: true });
  });

  it("creates the file before the first event, so a reader can start tailing", async () => {
    const writer = await openRunEvents(henchDir, "run-1");
    expect(await readFile(writer.path, "utf-8")).toBe("");
    expect(await writer.close()).toBeNull();
  });

  it("writes one parseable JSON object per line, as they happen", async () => {
    const writer = await openRunEvents(henchDir, "run-2");

    writer.append({ kind: "brief_loaded", at: "2026-01-01T00:00:00.000Z", summary: "Brief loaded" });
    writer.append({ kind: "run_finished", at: "2026-01-01T00:01:00.000Z", summary: "Run completed" });

    // Readable while still open — the point of the file. Retried rather than
    // slept on: the writer hands each line to Node's buffer without awaiting.
    const events = await eventsWhenSettled(writer.path, 2);
    expect(events.map((e) => e.kind)).toEqual(["brief_loaded", "run_finished"]);

    expect(await writer.close()).toBeNull();
  });

  it("keeps summaries on one line, so one event is always one line", async () => {
    const writer = await openRunEvents(henchDir, "run-3");
    writer.append({
      kind: "retry",
      at: "2026-01-01T00:00:00.000Z",
      summary: "transient error",
      detail: "line one\nline two\r\nline three",
    });
    await writer.close();

    const events = await eventsIn(writer.path);
    expect(events).toHaveLength(1);
    expect(events[0].detail).toBe("line one line two line three");
  });

  it("never throws from append once the file is closed", async () => {
    const writer = await openRunEvents(henchDir, "run-4");
    await writer.close();
    // Appending after close is a no-op, not a crash: the agent loop must never
    // die because its narration outlived the file.
    expect(() => writer.append({ kind: "run_finished", at: "x", summary: "y" })).not.toThrow();
  });

  it("rejects when the directory cannot be created, where the caller can react", async () => {
    await expect(openRunEvents(join(henchDir, "not-a-dir\0bad"), "run-5")).rejects.toThrow();
  });
});

describe("emitRunEvent", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-runevents-emit-"));
  });

  afterEach(async () => {
    await closeActiveRunEvents();
    await rm(henchDir, { recursive: true, force: true });
  });

  it("is a no-op when no run is active", () => {
    setActiveRunEvents(null);
    expect(() => emitRunEvent("gate", "test gate passed", { ok: true })).not.toThrow();
  });

  it("stamps a timestamp and routes to the active writer", async () => {
    const writer = await openRunEvents(henchDir, "run-6");
    setActiveRunEvents(writer);

    emitRunEvent("gate", "Test gate passed", { ok: true, counts: { packages: 6, passed: 6 } });
    await closeActiveRunEvents();

    const [event] = await eventsIn(writer.path);
    expect(event.kind).toBe("gate");
    expect(event.summary).toBe("Test gate passed");
    expect(event.ok).toBe(true);
    expect(event.counts).toEqual({ packages: 6, passed: 6 });
    expect(Date.parse(event.at)).not.toBeNaN();
  });
});

describe("recordFileRead / flushFileReads", () => {
  let henchDir: string;
  let writer: RunEventWriter;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-runevents-reads-"));
    writer = await openRunEvents(henchDir, "run-reads");
    setActiveRunEvents(writer);
  });

  afterEach(async () => {
    await closeActiveRunEvents();
    await rm(henchDir, { recursive: true, force: true });
  });

  it("batches a turn's reads into one event, flushed when the turn advances", async () => {
    recordFileRead("src/a.ts", 1);
    recordFileRead("src/b.ts", 1);
    // Nothing yet — turn 1 is still open.
    expect(await eventsIn(writer.path)).toEqual([]);

    recordFileRead("src/c.ts", 2);
    await closeActiveRunEvents();

    const events = await eventsIn(writer.path);
    // Turn 2's single read is flushed by the close.
    expect(events.map((e) => e.turn)).toEqual([1, 2]);
    expect(events[0].kind).toBe("files_read");
    expect(events[0].counts).toEqual({ files: 2 });
    expect(events[0].summary).toBe("Read 2 files");
  });

  it("names the file when a turn read exactly one", async () => {
    recordFileRead("src/only.ts", 1);
    await closeActiveRunEvents();

    const [event] = await eventsIn(writer.path);
    expect(event.summary).toBe("Read src/only.ts");
  });

  it("counts each path once per turn", async () => {
    recordFileRead("src/a.ts", 1);
    recordFileRead("src/a.ts", 1);
    await closeActiveRunEvents();

    const [event] = await eventsIn(writer.path);
    expect(event.counts).toEqual({ files: 1 });
  });

  it("emits nothing when the turn read nothing", async () => {
    flushFileReads();
    flushFileReads();
    await closeActiveRunEvents();

    expect(await eventsIn(writer.path)).toEqual([]);
  });

  it("bounds the listing but not the count", async () => {
    for (let i = 0; i < 12; i++) recordFileRead(`src/f${i}.ts`, 1);
    await closeActiveRunEvents();

    const [event] = await eventsIn(writer.path);
    expect(event.counts).toEqual({ files: 12 });
    expect(event.detail).toContain("+4 more");
  });

  it("closes the pending batch before any other kind, so the stream stays chronological", async () => {
    // Reads are emitted at flush time, not read time. The agent's final turn
    // reads a file and the spawn ends; nothing advances the turn, so the batch
    // is still open when the gates and run_finished are emitted. Without the
    // flush in emitRunEvent those land first and the file says the run read a
    // file after it finished.
    recordFileRead("src/last.ts", 7);

    emitRunEvent("gate", "Test gate passed", { ok: true });
    emitRunEvent("run_finished", "Run completed", { ok: true });
    await closeActiveRunEvents();

    const events = await eventsIn(writer.path);
    expect(events.map((e) => e.kind)).toEqual(["files_read", "gate", "run_finished"]);
  });

  it("leaves run_finished last when the final turn read nothing", async () => {
    emitRunEvent("run_finished", "Run completed", { ok: true });
    await closeActiveRunEvents();

    const events = await eventsIn(writer.path);
    expect(events.map((e) => e.kind)).toEqual(["run_finished"]);
  });

  it("drops a pending batch when the active writer is replaced", async () => {
    recordFileRead("src/a.ts", 1);

    // A second run in the same process (`--loop`) must not inherit the first
    // run's unflushed reads.
    const second = await openRunEvents(henchDir, "run-reads-b");
    setActiveRunEvents(second);
    await closeActiveRunEvents();

    expect(await eventsIn(second.path)).toEqual([]);
  });
});

describe("classifyFileTool", () => {
  it("recognises the Claude CLI read and edit vocabulary", () => {
    expect(classifyFileTool("Read")).toBe("read");
    expect(classifyFileTool("Edit")).toBe("edit");
    expect(classifyFileTool("Write")).toBe("edit");
    expect(classifyFileTool("NotebookEdit")).toBe("edit");
  });

  it("recognises the API loop's snake_case vocabulary", () => {
    expect(classifyFileTool("read_file")).toBe("read");
    expect(classifyFileTool("write_file")).toBe("edit");
  });

  it("classifies exactly the file tools the API loop dispatches", async () => {
    // Pins the table against the real definitions in both directions: a tool
    // renamed there silently stops producing events, and a new file tool added
    // there should be classified deliberately rather than fall through as
    // "not a file tool".
    const { TOOL_DEFINITIONS_NEUTRAL } = await import("../../../src/tools/dispatch.js");
    const classified = TOOL_DEFINITIONS_NEUTRAL.map((d) => d.name)
      .filter((name) => classifyFileTool(name) !== null)
      .sort();

    expect(classified).toEqual(["list_directory", "read_file", "search_files", "write_file"]);
  });

  it("classifies searches as reads, since they are how the agent looks around", () => {
    expect(classifyFileTool("Glob")).toBe("read");
    expect(classifyFileTool("Grep")).toBe("read");
  });

  it("returns null for anything it does not model", () => {
    // A shell call may well edit a file; nothing here can tell, and guessing
    // would put wrong lines on the Work tab.
    expect(classifyFileTool("Bash")).toBeNull();
    expect(classifyFileTool("shell")).toBeNull();
    expect(classifyFileTool("")).toBeNull();
  });
});

describe("summariseFileEdit", () => {
  it("reports an old/new string pair as lines added and removed", () => {
    const edit = summariseFileEdit({
      file_path: "/repo/src/a.ts",
      old_string: "one\ntwo",
      new_string: "one\ntwo\nthree\nfour",
    });
    expect(edit).toEqual({
      path: "/repo/src/a.ts",
      summary: "Edited /repo/src/a.ts (+4 −2)",
      counts: { linesAdded: 4, linesRemoved: 2 },
    });
  });

  it("reports whole content as the file's line count", () => {
    expect(summariseFileEdit({ file_path: "a.ts", content: "x\ny\n" })).toEqual({
      path: "a.ts",
      summary: "Wrote a.ts (2 lines)",
      counts: { lines: 2 },
    });
  });

  it("counts a truncating write as zero lines, not as an absent one", () => {
    expect(summariseFileEdit({ file_path: "a.ts", content: "" })).toEqual({
      path: "a.ts",
      summary: "Wrote a.ts (0 lines)",
      counts: { lines: 0 },
    });
  });

  it("accepts the API loop's `path` key as well as `file_path`", () => {
    expect(summariseFileEdit({ path: "b.ts", content: "x" })?.path).toBe("b.ts");
  });

  it("accepts a notebook path", () => {
    expect(summariseFileEdit({ notebook_path: "n.ipynb" })?.path).toBe("n.ipynb");
  });

  it("returns null without a usable path, rather than inventing one", () => {
    expect(summariseFileEdit({})).toBeNull();
    expect(summariseFileEdit({ file_path: 42 })).toBeNull();
  });

  it("still reports the edit when the strings are absent", () => {
    // A vendor that does not echo the content back still produced an edit; the
    // event says so with no counts rather than being dropped.
    const edit = summariseFileEdit({ file_path: "a.ts" });
    expect(edit).toEqual({ path: "a.ts", summary: "Edited a.ts", counts: undefined });
  });
});

describe("recordFileWork", () => {
  let henchDir: string;
  let writer: RunEventWriter;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-runevents-work-"));
    writer = await openRunEvents(henchDir, "run-work");
    setActiveRunEvents(writer);
  });

  afterEach(async () => {
    await closeActiveRunEvents();
    await rm(henchDir, { recursive: true, force: true });
  });

  it("emits an edit immediately, and flushes the reads that preceded it", async () => {
    recordFileWork("Read", { file_path: "src/a.ts" }, 1);
    recordFileWork("Edit", { file_path: "src/a.ts", old_string: "x", new_string: "x\ny" }, 1);
    await closeActiveRunEvents();

    const events = await eventsIn(writer.path);
    expect(events.map((e) => e.kind)).toEqual(["files_read", "file_edited"]);
    expect(events[1].summary).toBe("Edited src/a.ts (+2 −1)");
    expect(events[1].turn).toBe(1);
    expect(events[1].counts).toEqual({ linesAdded: 2, linesRemoved: 1 });
  });

  it("ignores a search that names no file, rather than counting the pattern", async () => {
    recordFileWork("Grep", { pattern: "foo.*bar" }, 1);
    await closeActiveRunEvents();

    expect(await eventsIn(writer.path)).toEqual([]);
  });

  it("counts a search scoped to a directory as a read of that path", async () => {
    recordFileWork("Grep", { pattern: "foo", path: "src/" }, 1);
    await closeActiveRunEvents();

    const [event] = await eventsIn(writer.path);
    expect(event.summary).toBe("Read src/");
  });

  it("ignores tools it does not model", async () => {
    recordFileWork("Bash", { command: "rm -rf src" }, 1);
    recordFileWork("shell", { command: "echo hi > a.ts" }, 1);
    await closeActiveRunEvents();

    expect(await eventsIn(writer.path)).toEqual([]);
  });

  it("handles an absent input without throwing", () => {
    expect(() => recordFileWork("Read", undefined, 1)).not.toThrow();
    expect(() => recordFileWork("Write", undefined, 1)).not.toThrow();
  });
});
