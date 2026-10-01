import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
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
