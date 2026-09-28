import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdLog } from "../../../../src/cli/commands/log.js";

describe("cmdLog", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-log-test-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true });
  });

  it("refuses without a .rex directory", async () => {
    await expect(cmdLog(tmp, "task_started", {})).rejects.toThrow(CLIError);
  });

  it("appends an entry with the given event, item, and detail", async () => {
    mkdirSync(join(tmp, ".rex"));

    await cmdLog(tmp, "implementation_started", { item: "abc123", detail: "Extracted shared writer" });

    const raw = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
    const entry = JSON.parse(raw.trim().split("\n")[0]);
    expect(entry.event).toBe("implementation_started");
    expect(entry.itemId).toBe("abc123");
    expect(entry.detail).toBe("Extracted shared writer");
  });

  it("appends an entry with no item or detail", async () => {
    mkdirSync(join(tmp, ".rex"));

    await cmdLog(tmp, "task_completed", {});

    const raw = readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8");
    const entry = JSON.parse(raw.trim().split("\n")[0]);
    expect(entry.event).toBe("task_completed");
    expect(entry.itemId).toBeUndefined();
  });

  it("prints a JSON summary with --format=json", async () => {
    mkdirSync(join(tmp, ".rex"));

    await cmdLog(tmp, "task_started", { item: "abc123", format: "json" });

    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(printed);
    expect(parsed.logged).toBe(true);
    expect(parsed.event).toBe("task_started");
    expect(parsed.itemId).toBe("abc123");
  });

  // The parser turns a bare `--item` into "true", so the space-separated
  // `--item abc123 .` form arrives with the id already dropped. Writing it
  // anyway files the audit entry against an item that does not exist and
  // still exits 0 — the caller is told the attribution worked.
  it("refuses a valueless --item instead of logging itemId \"true\"", async () => {
    mkdirSync(join(tmp, ".rex"));

    await expect(cmdLog(tmp, "task_done", { item: "true" })).rejects.toThrow(/--item needs a value/);
    await expect(cmdLog(tmp, "task_done", { item: "  " })).rejects.toThrow(/--item needs a value/);

    expect(existsSync(join(tmp, ".rex", "execution-log.jsonl"))).toBe(false);
  });

  // `--format=json` is advertised for scripting, so it must not report a
  // detail the log does not contain: the store truncates past 2,000 chars.
  it("does not echo a detail the store truncated", async () => {
    mkdirSync(join(tmp, ".rex"));
    const longDetail = "d".repeat(2500);

    await cmdLog(tmp, "long_event", { detail: longDetail, format: "json" });

    const parsed = JSON.parse(logSpy.mock.calls.map((c) => c[0]).join("\n"));
    const written = JSON.parse(
      readFileSync(join(tmp, ".rex", "execution-log.jsonl"), "utf-8").trim(),
    );

    expect(written.detail).toBe("d".repeat(2000) + "...");
    // Every reported field is one the store wrote through unchanged.
    expect(parsed.detail).toBeUndefined();
    expect(parsed.event).toBe(written.event);
    expect(parsed.timestamp).toBe(written.timestamp);
  });

  it("prints a human-readable line by default", async () => {
    mkdirSync(join(tmp, ".rex"));

    await cmdLog(tmp, "task_started", { item: "abc123" });

    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("task_started");
    expect(printed).toContain("abc123");
  });
});
