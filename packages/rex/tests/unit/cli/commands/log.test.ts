import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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

  it("prints a human-readable line by default", async () => {
    mkdirSync(join(tmp, ".rex"));

    await cmdLog(tmp, "task_started", { item: "abc123" });

    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("task_started");
    expect(printed).toContain("abc123");
  });
});
