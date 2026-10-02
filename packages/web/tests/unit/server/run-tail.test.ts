import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  confineTailPath,
  utf8CompletePrefixLength,
  readEventsAfter,
  readLogChunk,
  watchRunTail,
  stopRunTailWatches,
  RUN_TAIL_LEASE_MS,
  RUN_TAIL_POLL_MS,
} from "../../../src/server/run-tail.js";

describe("utf8CompletePrefixLength", () => {
  it.each([
    ["ascii", "a"],
    ["2-byte", "é"],
    ["3-byte", "€"],
    ["4-byte", "😀"],
  ])("keeps a complete %s character and drops every truncation of it", (_name, ch) => {
    const full = Buffer.from(`x${ch}`);
    expect(utf8CompletePrefixLength(full)).toBe(full.length);
    for (let cut = 2; cut < full.length; cut++) {
      expect(utf8CompletePrefixLength(full.subarray(0, cut))).toBe(1);
    }
  });

  it("handles an empty buffer", () => {
    expect(utf8CompletePrefixLength(Buffer.alloc(0))).toBe(0);
  });

  it.each([
    ["0xF8", [0x41, 0xf8]],
    ["0xFF", [0x41, 0xff]],
    ["0xF5", [0x41, 0xf5, 0x80]],
    ["overlong 0xC0", [0x41, 0xc0]],
  ])("does not hold back a lead byte that can never complete (%s)", (_name, bytes) => {
    expect(utf8CompletePrefixLength(Buffer.from(bytes))).toBe(bytes.length);
  });
});

describe("readers", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-run-tail-unit-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("pages a log by maxBytes, and concatenated pages reproduce the file", () => {
    const path = join(dir, "a.log");
    const text = "héllo wörld €😀\n".repeat(5);
    writeFileSync(path, text);
    let out = "";
    let cursor = 0;
    for (let i = 0; i < 100; i++) {
      const chunk = readLogChunk(path, cursor, 7);
      out += chunk.content;
      if (chunk.next === chunk.size) break;
      expect(chunk.next).toBeGreaterThan(cursor);
      cursor = chunk.next;
    }
    expect(out).toBe(text);
  });

  it("holds an unfinished trailing character while the log can still grow", () => {
    const path = join(dir, "partial.log");
    writeFileSync(path, Buffer.from([0x41, 0xe9]));
    const chunk = readLogChunk(path, 0);
    expect(chunk.content).toBe("A");
    expect(chunk.next).toBe(1);
  });

  it("emits an unfinished trailing character as U+FFFD once the log is final", () => {
    const path = join(dir, "partial.log");
    writeFileSync(path, Buffer.from([0x41, 0xe9]));
    const chunk = readLogChunk(path, 0, undefined, { final: true });
    expect(chunk.content).toBe("A�");
    expect(chunk.next).toBe(2);
    expect(chunk.size).toBe(2);
  });

  it("still holds a split character mid-file when final, if the page ends before EOF", () => {
    const path = join(dir, "split.log");
    writeFileSync(path, "aé!");
    const chunk = readLogChunk(path, 0, 2, { final: true });
    expect(chunk.content).toBe("a");
    expect(chunk.next).toBe(1);
  });

  it("spends a seq on a malformed event line without returning it", () => {
    const path = join(dir, "e.jsonl");
    writeFileSync(path, '{"kind":"a"}\nnot json\n{"kind":"b"}\n');
    const chunk = readEventsAfter(path, 0);
    expect(chunk.events.map((e) => [e.seq, e.kind])).toEqual([[1, "a"], [3, "b"]]);
    expect(chunk.next).toBe(3);
    expect(chunk.total).toBe(3);
  });

  it("caps events per response and resumes from next", () => {
    const path = join(dir, "e.jsonl");
    writeFileSync(path, Array.from({ length: 5 }, (_, i) => `{"n":${i}}\n`).join(""));
    const first = readEventsAfter(path, 0, 2);
    expect(first.events.map((e) => e.seq)).toEqual([1, 2]);
    const second = readEventsAfter(path, first.next, 10);
    expect(second.events.map((e) => e.seq)).toEqual([3, 4, 5]);
  });
});

describe("confineTailPath", () => {
  let dir: string;
  let root: string;
  let secretDir: string;
  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-run-tail-confine-")));
    root = join(dir, "repo");
    secretDir = join(dir, "secret");
    mkdirSync(root);
    mkdirSync(secretDir);
    writeFileSync(join(secretDir, "id_rsa"), "do not serve\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("serves a file inside a real .run-logs/", () => {
    mkdirSync(join(root, ".run-logs"));
    const path = join(root, ".run-logs", "a.log");
    writeFileSync(path, "x");
    expect(confineTailPath(path, [root])).toBe(path);
  });

  it("refuses a file reached through a symlinked .run-logs/", () => {
    symlinkSync(secretDir, join(root, ".run-logs"));
    expect(confineTailPath(join(root, ".run-logs", "id_rsa"), [root])).toBeNull();
  });

  it("refuses a file reached through a symlinked .hench/", () => {
    mkdirSync(join(secretDir, "runs"));
    writeFileSync(join(secretDir, "runs", "r.events.jsonl"), "{}\n");
    symlinkSync(secretDir, join(root, ".hench"));
    expect(confineTailPath(join(root, ".hench", "runs", "r.events.jsonl"), [root])).toBeNull();
  });

  it("accepts a worktree root that is itself reached through a symlink", () => {
    const alias = join(dir, "alias");
    symlinkSync(root, alias);
    mkdirSync(join(root, ".run-logs"));
    const path = join(root, ".run-logs", "a.log");
    writeFileSync(path, "x");
    expect(confineTailPath(join(alias, ".run-logs", "a.log"), [alias])).toBe(path);
  });
});

describe("watchRunTail", () => {
  let dir: string;
  beforeEach(() => {
    vi.useFakeTimers();
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-run-tail-watch-")));
  });
  afterEach(() => {
    stopRunTailWatches();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stops announcing once the lease expires without renewal", () => {
    const path = join(dir, "a.log");
    writeFileSync(path, "a\n");
    const broadcast = vi.fn();
    watchRunTail({ key: "k", runId: "r", logPath: path, broadcast });

    writeFileSync(path, "a\nb\n");
    vi.advanceTimersByTime(RUN_TAIL_POLL_MS);
    expect(broadcast).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RUN_TAIL_LEASE_MS);
    writeFileSync(path, "a\nb\nc\n");
    vi.advanceTimersByTime(RUN_TAIL_POLL_MS * 2);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("announces a shrink so a client with a stale cursor re-reads", () => {
    const path = join(dir, "a.log");
    writeFileSync(path, "long content\n");
    const broadcast = vi.fn();
    watchRunTail({ key: "k", runId: "r", logPath: path, broadcast });
    writeFileSync(path, "x\n");
    vi.advanceTimersByTime(RUN_TAIL_POLL_MS);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ stream: "log", size: 2 }));
  });
});
