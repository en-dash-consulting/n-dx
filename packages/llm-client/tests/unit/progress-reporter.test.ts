/**
 * Unit tests for the monotonic progress reporter.
 *
 * Covers: the displayed counter never decreasing across phase/batch
 * transitions, and the "retry n/m: <reason>" line format (with progress-line
 * redraw) used by the LLM providers' default rate-limit retry handlers.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createProgressReporter,
  formatRetryLine,
  printRetryLine,
  setActiveProgressReporter,
  getActiveProgressReporter,
} from "../../src/progress-reporter.js";

function fakeTTYStream() {
  const writes: string[] = [];
  return {
    isTTY: true,
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    writes,
  } as unknown as NodeJS.WriteStream & { writes: string[] };
}

function fakeNonTTYStream() {
  const writes: string[] = [];
  return {
    isTTY: false,
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    writes,
  } as unknown as NodeJS.WritableStream & { writes: string[] };
}

// ── monotonicity ────────────────────────────────────────────────────────

describe("ProgressReporter monotonicity", () => {
  it("never returns a lower value than the previous call across phase and batch transitions", () => {
    const reporter = createProgressReporter(fakeNonTTYStream());
    const displayed: number[] = [];

    // Phase 1: inventory, 1..3
    displayed.push(reporter.advance("inventory", 1, 3));
    displayed.push(reporter.advance("inventory", 2, 3));
    displayed.push(reporter.advance("inventory", 3, 3));

    // Phase 2: classify batches, resets its own local counter to 1
    displayed.push(reporter.advance("classify:batch", 1, 5));
    displayed.push(reporter.advance("classify:batch", 2, 5));

    // Phase 4: zone enrichment pass counter, also resets locally to 1
    displayed.push(reporter.advance("zones:enrichment-pass", 1, 2));
    displayed.push(reporter.advance("zones:enrichment-pass", 2, 2));

    // Back to a batch-style counter within the same phase, local count drops
    // to 1 again (e.g. a fresh batch loop) — still must not go backwards.
    displayed.push(reporter.advance("zones:enrichment-pass", 1, 4));

    for (let i = 1; i < displayed.length; i++) {
      expect(displayed[i]).toBeGreaterThanOrEqual(displayed[i - 1]);
    }
    // Sanity: the raw (non-monotonic) local counters actually would have
    // decreased at the phase transitions, so this is testing something real.
    expect(displayed).toEqual([1, 2, 3, 4, 5, 6, 7, 7]);
  });

  it("keeps the display flat when a phase's own counter fails to advance", () => {
    const reporter = createProgressReporter(fakeNonTTYStream());
    const first = reporter.advance("retry-loop", 2, 5);
    const second = reporter.advance("retry-loop", 1, 5); // e.g. an attempt counter reset
    expect(second).toBeGreaterThanOrEqual(first);
  });
});

// ── retry line format ───────────────────────────────────────────────────

describe("formatRetryLine", () => {
  it("formats as 'retry n/m: <reason>'", () => {
    expect(formatRetryLine(2, 4, "rate limited, waiting 5s")).toBe(
      "retry 2/4: rate limited, waiting 5s",
    );
  });
});

describe("ProgressReporter.retryLine", () => {
  it("prints the retry line on its own line and redraws the last progress line (TTY)", () => {
    const stream = fakeTTYStream();
    const reporter = createProgressReporter(stream);

    reporter.render("[phase 3] Classifications: 4/10");
    stream.writes.length = 0; // ignore the initial render for this assertion

    reporter.retryLine(2, 4, "rate limited, waiting 5s");

    const combined = stream.writes.join("");
    // The retry line appears verbatim, on its own line.
    expect(combined).toContain("\nretry 2/4: rate limited, waiting 5s\n");
    // The progress line is redrawn afterward.
    expect(combined.endsWith("\r\x1b[K[phase 3] Classifications: 4/10")).toBe(true);
  });

  it("prints a plain line with no redraw when no progress line was rendered yet", () => {
    const stream = fakeTTYStream();
    const reporter = createProgressReporter(stream);

    reporter.retryLine(1, 3, "rate limited, waiting 1s");

    expect(stream.writes.join("")).toBe("retry 1/3: rate limited, waiting 1s\n");
  });

  it("prints a plain line on non-TTY streams", () => {
    const stream = fakeNonTTYStream();
    const reporter = createProgressReporter(stream);

    reporter.render("progress: 1/2");
    reporter.retryLine(1, 2, "rate limited, waiting 3s");

    expect(stream.writes).toEqual([
      "progress: 1/2\n",
      "retry 1/2: rate limited, waiting 3s\n",
    ]);
  });
});

// ── active reporter registry + printRetryLine ──────────────────────────

describe("printRetryLine / active progress reporter registry", () => {
  afterEach(() => {
    setActiveProgressReporter(null);
  });

  it("routes through the active reporter's retryLine when one is registered", () => {
    const stream = fakeTTYStream();
    const reporter = createProgressReporter(stream);
    reporter.render("working: 3/9");
    stream.writes.length = 0;

    setActiveProgressReporter(reporter);
    expect(getActiveProgressReporter()).toBe(reporter);

    printRetryLine(1, 3, "rate limited, waiting 2s");

    const combined = stream.writes.join("");
    expect(combined).toContain("retry 1/3: rate limited, waiting 2s");
    expect(combined.endsWith("\r\x1b[Kworking: 3/9")).toBe(true);
  });

  it("falls back to a plain stderr line when no reporter is active", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    setActiveProgressReporter(null);

    printRetryLine(3, 3, "rate limited, waiting 10s");

    expect(writeSpy).toHaveBeenCalledWith("retry 3/3: rate limited, waiting 10s\n");
    writeSpy.mockRestore();
  });
});
