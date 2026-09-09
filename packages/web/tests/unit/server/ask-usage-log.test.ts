/**
 * Tests for the Ask token-spend log.
 *
 * Two properties carry the weight. Recording must never fail the request that
 * produced it — an answer the user waited for is worth more than its own
 * bookkeeping line — and reading must survive a torn line, because the file is
 * appended to by a live server and a half-written final line is a real state,
 * not a corrupt one.
 *
 * @see packages/web/src/server/ask-usage-log.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordAskUsage,
  readAskUsage,
  askUsageCounters,
  askUsageLogPath,
  ASK_USAGE_FILE,
} from "../../../src/server/ask-usage-log.js";
import type { AskUsageEntry } from "../../../src/server/ask-usage-log.js";

function entry(overrides: Partial<AskUsageEntry> = {}): AskUsageEntry {
  return {
    timestamp: "2026-09-09T12:00:00.000Z",
    vendor: "claude",
    model: "claude-sonnet-5",
    inputTokens: 1200,
    outputTokens: 42,
    cacheCreationTokens: 300,
    cacheReadTokens: 900,
    ok: true,
    ...overrides,
  };
}

describe("ask usage log", () => {
  let svDir: string;

  beforeEach(async () => {
    svDir = await mkdtemp(join(tmpdir(), "ask-usage-"));
  });

  afterEach(async () => {
    await rm(svDir, { recursive: true, force: true });
  });

  it("round-trips an entry with its cache tokens intact", async () => {
    expect(await recordAskUsage(svDir, entry())).toBe(true);

    const read = await readAskUsage(svDir);
    expect(read).toHaveLength(1);
    // Cache tokens are most of the bill on a cached context — reported, not
    // folded into inputTokens, matching hench and rex.
    expect(read[0]).toEqual(entry());
  });

  it("appends rather than replacing, so history accumulates", async () => {
    await recordAskUsage(svDir, entry({ timestamp: "2026-09-09T12:00:00.000Z" }));
    await recordAskUsage(svDir, entry({ timestamp: "2026-09-09T12:05:00.000Z" }));

    const read = await readAskUsage(svDir);
    expect(read.map((e) => e.timestamp)).toEqual([
      "2026-09-09T12:00:00.000Z",
      "2026-09-09T12:05:00.000Z",
    ]);
  });

  it("writes one JSON object per line", async () => {
    await recordAskUsage(svDir, entry());
    await recordAskUsage(svDir, entry());

    const raw = await readFile(askUsageLogPath(svDir), "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(askUsageLogPath(svDir).endsWith(ASK_USAGE_FILE)).toBe(true);
  });

  it("records a failed ask with its reason rather than dropping it", async () => {
    await recordAskUsage(svDir, entry({ ok: false, reason: "timeout", outputTokens: 0 }));

    const read = await readAskUsage(svDir);
    expect(read[0]!.ok).toBe(false);
    expect(read[0]!.reason).toBe("timeout");
    // The input was still sent, so its tokens are still spend.
    expect(read[0]!.inputTokens).toBe(1200);
  });

  it("reports rather than throws when the log cannot be written", async () => {
    const missing = join(svDir, "no", "such", "dir");

    // The caller is mid-request; a bookkeeping failure must not become the
    // user's error.
    await expect(recordAskUsage(missing, entry())).resolves.toBe(false);
  });

  it("returns nothing when no ask has been recorded yet", async () => {
    expect(await readAskUsage(svDir)).toEqual([]);
  });

  it("skips a torn final line instead of losing the whole history", async () => {
    await recordAskUsage(svDir, entry({ inputTokens: 100 }));
    await recordAskUsage(svDir, entry({ inputTokens: 200 }));
    // A live append interrupted mid-write.
    await writeFile(
      askUsageLogPath(svDir),
      `${await readFile(askUsageLogPath(svDir), "utf-8")}{"timestamp":"2026-09-09T13`,
      "utf-8",
    );

    const read = await readAskUsage(svDir);
    expect(read.map((e) => e.inputTokens)).toEqual([100, 200]);
  });

  it("skips a well-formed line that is not an entry", async () => {
    await writeFile(
      askUsageLogPath(svDir),
      ['{"note":"hand-edited"}', JSON.stringify(entry()), "null"].join("\n"),
      "utf-8",
    );

    const read = await readAskUsage(svDir);
    expect(read).toHaveLength(1);
    expect(read[0]!.vendor).toBe("claude");
  });

  it("reads a directory that exists but holds no log", async () => {
    await mkdir(join(svDir, "nested"), { recursive: true });
    expect(await readAskUsage(join(svDir, "nested"))).toEqual([]);
  });
});

describe("askUsageCounters", () => {
  it("carries every counter through, cache fields included", () => {
    expect(askUsageCounters({
      input: 10, output: 20, cacheCreationInput: 30, cacheReadInput: 40,
    })).toEqual({
      inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40,
    });
  });

  it("treats absent cache fields as zero, not as missing", () => {
    // Providers that report usage report cache fields when non-zero, so an
    // absent field is a real zero — an ask must not land in the rollup with
    // undefined counters that arithmetic turns into NaN.
    expect(askUsageCounters({ input: 5, output: 6 })).toEqual({
      inputTokens: 5, outputTokens: 6, cacheCreationTokens: 0, cacheReadTokens: 0,
    });
  });

  it("zeroes everything when the provider reported no usage at all", () => {
    for (const usage of [undefined, null]) {
      expect(askUsageCounters(usage)).toEqual({
        inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      });
    }
  });
});
