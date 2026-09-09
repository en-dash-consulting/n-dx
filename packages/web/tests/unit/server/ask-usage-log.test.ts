/**
 * Ask spend ledger.
 *
 * The ledger is the only durable record of what the dashboard's own LLM
 * calls cost, so the properties that matter are: an append survives, a
 * corrupt line costs only itself, and a write that cannot happen never
 * propagates as an exception into the ask that was being answered.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ASK_USAGE_FILE,
  NO_ASK_TOKENS,
  recordAskUsage,
  readAskUsageEntries,
} from "../../../src/server/ask-usage-log.js";
import type { AskUsageEntry } from "../../../src/server/ask-usage-log.js";

let svDir: string;

function entry(overrides: Partial<AskUsageEntry> = {}): AskUsageEntry {
  return {
    timestamp: "2026-09-09T12:00:00.000Z",
    vendor: "claude",
    model: "claude-opus-5",
    tier: "standard",
    outcome: "answered",
    durationMs: 2400,
    inputTokens: 1200,
    outputTokens: 90,
    cacheCreationTokens: 0,
    cacheReadTokens: 400,
    ...overrides,
  };
}

beforeEach(async () => {
  svDir = join(await mkdtemp(join(tmpdir(), "ndx-ask-log-")), ".sourcevision");
});

afterEach(async () => {
  await rm(join(svDir, ".."), { recursive: true, force: true });
});

describe("recordAskUsage", () => {
  it("creates the directory and appends one line per ask", async () => {
    expect(recordAskUsage(svDir, entry())).toBe(true);
    expect(recordAskUsage(svDir, entry({ timestamp: "2026-09-09T12:05:00.000Z" }))).toBe(true);

    const raw = await readFile(join(svDir, ASK_USAGE_FILE), "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    // Newline-terminated, so the next append cannot land on the same line.
    expect(raw.endsWith("\n")).toBe(true);
  });

  it("round-trips every field", async () => {
    recordAskUsage(svDir, entry({ outcome: "timeout", late: true }));
    const [read] = readAskUsageEntries(svDir);
    expect(read).toEqual(entry({ outcome: "timeout", late: true }));
  });

  it("reports failure instead of throwing when the ledger cannot be written", async () => {
    // A file where the directory must go: mkdir and append both fail, and the
    // caller is mid-response — an exception here would fail a paid-for ask.
    const blocked = join(svDir, "..", "blocker");
    await writeFile(blocked, "not a directory", "utf-8");
    expect(recordAskUsage(join(blocked, "nested"), entry())).toBe(false);
  });

  it("does not throw when the directory is unwritable", async () => {
    await mkdir(svDir, { recursive: true });
    await chmod(svDir, 0o500);
    try {
      expect(recordAskUsage(svDir, entry())).toBe(false);
    } finally {
      await chmod(svDir, 0o700);
    }
  });
});

describe("readAskUsageEntries", () => {
  it("returns nothing when the ledger does not exist", () => {
    expect(readAskUsageEntries(svDir)).toEqual([]);
  });

  it("returns entries oldest first, in append order", () => {
    recordAskUsage(svDir, entry({ timestamp: "2026-09-09T12:00:00.000Z" }));
    recordAskUsage(svDir, entry({ timestamp: "2026-09-09T12:05:00.000Z" }));
    expect(readAskUsageEntries(svDir).map((e) => e.timestamp)).toEqual([
      "2026-09-09T12:00:00.000Z",
      "2026-09-09T12:05:00.000Z",
    ]);
  });

  it("skips a truncated final line and keeps the rest", async () => {
    await mkdir(svDir, { recursive: true });
    await writeFile(
      join(svDir, ASK_USAGE_FILE),
      `${JSON.stringify(entry())}\n{"timestamp":"2026-09-09T12:05`,
      "utf-8",
    );
    const entries = readAskUsageEntries(svDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].inputTokens).toBe(1200);
  });

  it("skips a line with no usable timestamp rather than mis-bucketing it", async () => {
    await mkdir(svDir, { recursive: true });
    await writeFile(
      join(svDir, ASK_USAGE_FILE),
      [
        JSON.stringify({ ...entry(), timestamp: undefined }),
        JSON.stringify({ ...entry(), timestamp: "not-a-date" }),
        JSON.stringify(entry()),
      ].join("\n"),
      "utf-8",
    );
    expect(readAskUsageEntries(svDir)).toHaveLength(1);
  });

  it("defaults missing metadata rather than dropping the spend", async () => {
    await mkdir(svDir, { recursive: true });
    await writeFile(
      join(svDir, ASK_USAGE_FILE),
      JSON.stringify({ timestamp: "2026-09-09T12:00:00.000Z", outputTokens: 50 }),
      "utf-8",
    );
    const [read] = readAskUsageEntries(svDir);
    expect(read).toMatchObject({
      vendor: "unknown",
      model: "unknown",
      tier: "unknown",
      outcome: "answered",
      inputTokens: 0,
      outputTokens: 50,
    });
  });

  it("coerces non-numeric counts to zero", async () => {
    await mkdir(svDir, { recursive: true });
    await writeFile(
      join(svDir, ASK_USAGE_FILE),
      JSON.stringify({ ...entry(), inputTokens: "lots", outputTokens: null }),
      "utf-8",
    );
    const [read] = readAskUsageEntries(svDir);
    expect(read.inputTokens).toBe(0);
    expect(read.outputTokens).toBe(0);
  });

  it("keeps an unrecognized outcome readable as spend", async () => {
    await mkdir(svDir, { recursive: true });
    await writeFile(
      join(svDir, ASK_USAGE_FILE),
      JSON.stringify({ ...entry(), outcome: "cancelled-by-future-version" }),
      "utf-8",
    );
    const [read] = readAskUsageEntries(svDir);
    expect(read.outcome).toBe("answered");
    expect(read.inputTokens).toBe(1200);
  });

  it("ignores blank lines", async () => {
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, ASK_USAGE_FILE), `\n${JSON.stringify(entry())}\n\n`, "utf-8");
    expect(readAskUsageEntries(svDir)).toHaveLength(1);
  });
});

describe("NO_ASK_TOKENS", () => {
  it("zeroes every count, so an unreported outcome reads as zero rather than absent", () => {
    expect(NO_ASK_TOKENS).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });
});
