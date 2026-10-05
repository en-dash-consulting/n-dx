/**
 * Unit tests for the closing run summary.
 *
 * The summary is read back off disk rather than scraped from child output, so
 * these tests write the same artifacts `sv analyze` and `rex analyze` write and
 * assert what the orchestrator makes of them.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectRunSummary, formatRunSummary, formatCost } from "../../packages/core/run-summary.js";

const EFFECTS = {
  command: "plan",
  summary: "…",
  reads: ["…"],
  writes: [
    { path: ".sourcevision/", what: "analysis" },
    { path: ".rex/pending-proposals.json", what: "proposals" },
    { path: ".rex/prd_tree/", what: "items", conditional: true, when: "with --accept" },
  ],
  llm: [],
  network: [{ to: "llm-provider", what: "the configured LLM vendor" }],
  duration: "…",
  next: "ndx status",
};

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-run-summary-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write `.sourcevision/manifest.json` with a lastAnalysis block. */
async function writeManifest(llm, { at = new Date().toISOString(), narration } = {}) {
  await mkdir(join(dir, ".sourcevision"), { recursive: true });
  const manifest = { lastAnalysis: { at, mode: "cascade", durationMs: 1, phases: {}, llm } };
  if (narration) manifest.narration = narration;
  await writeFile(join(dir, ".sourcevision", "manifest.json"), JSON.stringify(manifest));
}

/** Append one `analyze_token_usage` line to rex's execution log. */
async function writeRexLog(detail, timestamp = new Date().toISOString()) {
  await mkdir(join(dir, ".rex"), { recursive: true });
  await writeFile(
    join(dir, ".rex", "execution-log.jsonl"),
    JSON.stringify({ timestamp, event: "analyze_token_usage", detail: JSON.stringify(detail) }) + "\n",
  );
}

describe("collectRunSummary — files written", () => {
  it("reports only the declared paths that the run touched", async () => {
    const startedAt = Date.now();
    await mkdir(join(dir, ".sourcevision"), { recursive: true });
    // .rex/pending-proposals.json and .rex/prd_tree/ were never written.

    const summary = collectRunSummary(dir, EFFECTS, startedAt);
    expect(summary.filesWritten).toEqual([".sourcevision/"]);
  });

  it("ignores a declared path that predates the run", async () => {
    await mkdir(join(dir, ".sourcevision"), { recursive: true });
    const old = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await utimes(join(dir, ".sourcevision"), old, old);

    const summary = collectRunSummary(dir, EFFECTS, Date.now());
    expect(summary.filesWritten).toEqual([]);
  });

  it("sees a file overwritten inside a declared directory", async () => {
    // The commonest case, and the one a directory's own mtime misses: most
    // filesystems bump a directory's mtime when an entry is added or removed
    // but not when an existing file is rewritten in place, which is exactly
    // what `sv analyze` does to a .sourcevision/ that already exists.
    await mkdir(join(dir, ".sourcevision"), { recursive: true });
    await writeFile(join(dir, ".sourcevision", "inventory.json"), "{}");
    const old = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    await utimes(join(dir, ".sourcevision"), old, old);

    const summary = collectRunSummary(dir, EFFECTS, Date.now() - 1000);
    expect(summary.filesWritten).toEqual([".sourcevision/"]);
  });

  it("reports nothing written when nothing exists", () => {
    expect(collectRunSummary(dir, EFFECTS, Date.now()).filesWritten).toEqual([]);
  });

  it("carries the declared next command through", () => {
    expect(collectRunSummary(dir, EFFECTS, Date.now()).next).toBe("ndx status");
  });
});

describe("collectRunSummary — LLM usage", () => {
  it("totals sourcevision's per-task-class buckets", async () => {
    await writeManifest({
      byTaskClass: {
        zones: { calls: 3, inputTokens: 1000, outputTokens: 200, durationMs: 1, vendor: "claude", model: "m" },
        findings: { calls: 1, inputTokens: 500, outputTokens: 100, durationMs: 1, vendor: "claude", model: "m" },
      },
      costUsd: 0.042,
    });

    const summary = collectRunSummary(dir, EFFECTS, Date.now() - 1000);
    expect(summary.calls).toBe(4);
    expect(summary.inputTokens).toBe(1500);
    expect(summary.outputTokens).toBe(300);
    expect(summary.costUsd).toBeCloseTo(0.042);
  });

  it("reports cost as unrecorded rather than guessing it", async () => {
    // A manifest written before costUsd existed. The orchestration tier cannot
    // import the price table, so the only honest answer is "not recorded".
    await writeManifest({
      byTaskClass: {
        zones: { calls: 2, inputTokens: 100, outputTokens: 10, durationMs: 1, vendor: "claude", model: "m" },
      },
    });

    const summary = collectRunSummary(dir, EFFECTS, Date.now() - 1000);
    expect(summary.calls).toBe(2);
    expect(summary.costUsd).toBeNull();
  });

  it("sums sourcevision and rex, because plan runs both", async () => {
    await writeManifest({
      byTaskClass: {
        zones: { calls: 2, inputTokens: 100, outputTokens: 10, durationMs: 1, vendor: "claude", model: "m" },
      },
      costUsd: 0.01,
    });
    await writeRexLog({ calls: 5, inputTokens: 900, outputTokens: 90, costUsd: 0.02 });

    const summary = collectRunSummary(dir, EFFECTS, Date.now() - 1000);
    expect(summary.calls).toBe(7);
    expect(summary.inputTokens).toBe(1000);
    expect(summary.costUsd).toBeCloseTo(0.03);
  });

  it("ignores a rex log entry from an earlier run", async () => {
    // Without the timestamp floor a plan that made no calls would report last
    // week's spend as its own — the reason the cutoff exists at all.
    const lastWeek = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    await writeRexLog({ calls: 9, inputTokens: 9999, outputTokens: 99, costUsd: 1.5 }, lastWeek);

    const summary = collectRunSummary(dir, EFFECTS, Date.now());
    expect(summary.calls).toBe(0);
    expect(summary.costUsd).toBeNull();
  });

  it("ignores a sourcevision analysis from an earlier run", async () => {
    // `lastAnalysis` is the last analysis the *project* ran, not the last one
    // this command ran — and most commands never run sourcevision at all.
    // Without the cutoff, an interactive `ndx recommend .` after an
    // `ndx analyze .` billed itself for the analysis.
    await writeManifest(
      {
        byTaskClass: {
          zones: { calls: 9, inputTokens: 9999, outputTokens: 99, durationMs: 1, vendor: "claude", model: "m" },
        },
        costUsd: 1.5,
      },
      { at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString() },
    );

    const summary = collectRunSummary(dir, EFFECTS, Date.now());
    expect(summary.calls).toBe(0);
    expect(summary.costUsd).toBeNull();
  });

  it("treats an unparseable analysis timestamp as not ours", async () => {
    await writeManifest(
      { byTaskClass: { zones: { calls: 4, inputTokens: 40, outputTokens: 4, durationMs: 1, vendor: "claude", model: "m" } } },
      { at: "not a date" },
    );

    expect(collectRunSummary(dir, EFFECTS, Date.now() - 1000).calls).toBe(0);
  });

  it("reports a narrator this run queued and has not finished", async () => {
    // `analyze` spawns `sv narrate` detached and returns, so the summary prints
    // before that child records a token. The numbers are right about what has
    // been recorded and wrong about what the command will cost.
    await writeManifest(
      { byTaskClass: { zones: { calls: 1, inputTokens: 10, outputTokens: 1, durationMs: 1, vendor: "claude", model: "m" } } },
      { narration: { status: "pending", zones: ["z1"], startedAt: new Date().toISOString() } },
    );

    expect(collectRunSummary(dir, EFFECTS, Date.now() - 1000).narrationPending).toBe(true);
  });

  it("does not claim a narrator left pending by an earlier analyze", async () => {
    await writeManifest(
      { byTaskClass: {} },
      {
        at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
        narration: { status: "pending", zones: ["z1"], startedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString() },
      },
    );

    expect(collectRunSummary(dir, EFFECTS, Date.now()).narrationPending).toBe(false);
  });

  it("does not report a narrator that finished", async () => {
    await writeManifest(
      { byTaskClass: {} },
      { narration: { status: "done", zones: ["z1"], startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() } },
    );

    expect(collectRunSummary(dir, EFFECTS, Date.now() - 1000).narrationPending).toBe(false);
  });

  it("survives a malformed manifest and a torn log line", async () => {
    await mkdir(join(dir, ".sourcevision"), { recursive: true });
    await writeFile(join(dir, ".sourcevision", "manifest.json"), "{not json");
    await mkdir(join(dir, ".rex"), { recursive: true });
    await writeFile(join(dir, ".rex", "execution-log.jsonl"), '{"event":"analyze_token_usage"\n');

    const summary = collectRunSummary(dir, EFFECTS, Date.now());
    expect(summary.calls).toBe(0);
  });
});

describe("formatCost", () => {
  it("says so when nothing recorded a cost", () => {
    expect(formatCost(null)).toBe("not recorded");
  });

  it("never rounds a real spend away to $0.00", () => {
    expect(formatCost(0.0002)).toBe("<$0.001");
    expect(formatCost(0)).toBe("$0.00");
  });

  it("uses four decimals below a dollar and two above", () => {
    expect(formatCost(0.0421)).toBe("$0.0421");
    expect(formatCost(12.3456)).toBe("$12.35");
  });
});

describe("formatRunSummary", () => {
  const base = { filesWritten: [".sourcevision/"], calls: 4, inputTokens: 1500, outputTokens: 300, costUsd: 0.042, next: "ndx status" };

  it("lists files written, calls, tokens, cost and the next command", () => {
    const text = formatRunSummary(base).join("\n");
    expect(text).toContain(".sourcevision/");
    expect(text).toContain("4 calls");
    expect(text).toContain("1,800 tokens");
    expect(text).toContain("$0.0420");
    expect(text).toContain("ndx status");
  });

  it("says nothing was written rather than printing an empty list", () => {
    expect(formatRunSummary({ ...base, filesWritten: [] }).join("\n")).toContain("wrote    nothing");
  });

  it("says nothing was spent when no call was made", () => {
    const text = formatRunSummary({ ...base, calls: 0, costUsd: null }).join("\n");
    expect(text).toContain("no model calls");
    expect(text).not.toContain("not recorded");
  });

  it("says the running narrator is not counted, beside a total and beside none", () => {
    for (const calls of [0, 4]) {
      const text = formatRunSummary({ ...base, calls, narrationPending: true }).join("\n");
      expect(text).toContain("background narration is still running");
    }
    // And says nothing when there is no narrator.
    expect(formatRunSummary({ ...base, narrationPending: false }).join("\n")).not.toContain("narration");
  });

  it("emits no ANSI when given no colour functions", () => {
    expect(formatRunSummary(base).join("\n")).not.toMatch(/\x1b\[/);
  });
});
