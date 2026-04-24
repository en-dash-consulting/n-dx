import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setQuiet,
  isQuiet,
  info,
  result,
  section,
  subsection,
  stream,
  detail,
  resetRollingWindow,
  getCapturedLines,
  resetCapturedLines,
} from "../../../src/cli/output.js";
// _overrideTTY is internal — import directly from the source module
import { _overrideTTY } from "../../../src/types/output.js";

// ANSI escape codes asserted in the label-color tests below
const DIM    = "\x1b[2m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const ANSI_PREFIX = "\x1b[";

describe("CLI output", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setQuiet(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    setQuiet(false);
  });

  describe("setQuiet / isQuiet", () => {
    it("defaults to non-quiet", () => {
      expect(isQuiet()).toBe(false);
    });

    it("can enable quiet mode", () => {
      setQuiet(true);
      expect(isQuiet()).toBe(true);
    });
  });

  describe("info()", () => {
    it("prints when not quiet", () => {
      info("hello");
      expect(logSpy).toHaveBeenCalledWith("hello");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      info("hello");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("result()", () => {
    it("always prints", () => {
      setQuiet(true);
      result("essential");
      expect(logSpy).toHaveBeenCalledWith("essential");
    });
  });

  describe("section()", () => {
    it("prints a section header with rules", () => {
      section("My Section");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("═");
      expect(output).toContain("❯ My Section");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      section("My Section");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("subsection()", () => {
    it("prints a subsection header with dashes", () => {
      subsection("Turn 1/10");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("── Turn 1/10 ");
      expect(output).toContain("─");
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      subsection("Turn 1/10");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("stream()", () => {
    it("prints a labelled line with padded tag", () => {
      stream("Agent", "Hello world");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("[Agent]");
      expect(output).toContain("Hello world");
    });

    it("pads short labels for alignment", () => {
      stream("Tool", "read_file(…)");
      const output = logSpy.mock.calls[0][0] as string;
      // [Tool] is 6 chars, padded to 10, so there's whitespace before the text
      expect(output).toMatch(/\[Tool\]\s+read_file/);
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      stream("Agent", "Hello world");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("detail()", () => {
    it("prints indented detail text", () => {
      detail("42ms");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("42ms");
      // Should be indented to align with stream content
      expect(output).toMatch(/^\s+42ms$/);
    });

    it("suppresses output when quiet", () => {
      setQuiet(true);
      detail("42ms");
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// stream() label color mapping
// Verifies that [Tool], [Agent], and vendor labels are color-coded correctly,
// and that NO_COLOR / non-TTY environments produce plain text.
// ---------------------------------------------------------------------------

/**
 * Reset the llm-client color cache so env-var changes take effect.
 * Imported directly from @n-dx/llm-client (tests are exempt from the
 * gateway-import rule — gateways are a production-code concern).
 */
async function resetColor(): Promise<void> {
  const { resetColorCache } = await import("@n-dx/llm-client");
  resetColorCache();
}

function setColorMode(mode: "force" | "none" | "clear"): void {
  if (mode === "force") {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
  } else if (mode === "none") {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
  } else {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
  }
}

describe("stream() label color mapping", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    spy.mockRestore();
    setColorMode("clear");
    await resetColor();
  });

  // ── [Tool] → colorDim (grey/dim) ─────────────────────────────────────────

  it("[Tool] label contains dim ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Tool", "read_file(...)");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(DIM);
    expect(output).toContain("[Tool]");
  });

  it("[Tool] label is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    stream("Tool", "read_file(...)");
    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("[Tool]");
  });

  // ── [Agent] → colorWarn (yellow) ─────────────────────────────────────────

  it("[Agent] label contains yellow ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Agent", "Some agent response");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(YELLOW);
    expect(output).toContain("[Agent]");
  });

  it("[Agent] label is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    stream("Agent", "Some agent response");
    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("[Agent]");
  });

  // ── [Agent] text body → colorPink (magenta) ──────────────────────────────

  it("[Agent] text body contains magenta ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Agent", "Some agent narrative");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(MAGENTA);
    expect(output).toContain("Some agent narrative");
  });

  it("[Agent] text body is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    stream("Agent", "Some agent narrative");
    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("Some agent narrative");
  });

  it("[Tool] text body has no magenta code even when color is forced (only label colored)", async () => {
    setColorMode("force");
    await resetColor();
    stream("Tool", "read_file(path)");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(DIM); // label color
    // text body after the bracket should not contain magenta
    const afterBracket = output.split("[Tool]")[1] ?? "";
    expect(afterBracket).not.toContain(MAGENTA);
  });

  // ── vendor labels → yellow ────────────────────────────────────────────────

  it("[Codex] vendor label contains yellow ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Codex", "vendor output line");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(YELLOW);
    expect(output).toContain("[Codex]");
  });

  it("[claude] vendor label contains yellow ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("claude", "vendor output line");
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain(YELLOW);
    expect(output).toContain("[claude]");
  });

  it("[Codex] vendor label is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    stream("Codex", "vendor output line");
    const output = spy.mock.calls[0][0] as string;
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("[Codex]");
  });

  // ── unlisted labels → no color ───────────────────────────────────────────

  it("unlisted labels (e.g. [Result]) render without ANSI codes even when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    stream("Result", "some output");
    const output = spy.mock.calls[0][0] as string;
    // [Result] has no entry in STREAM_LABEL_COLORS — expect plain bracket
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("[Result]");
  });

  // ── alignment is preserved with and without color ─────────────────────────

  it("visible padding is the same whether or not color is applied", async () => {
    // Color-off baseline
    setColorMode("none");
    await resetColor();
    stream("Tool", "x");
    const plainOutput = (spy.mock.calls[0][0] as string);
    spy.mockClear();

    // Color-on
    setColorMode("force");
    await resetColor();
    stream("Tool", "x");
    const coloredOutput = (spy.mock.calls[0][0] as string);

    // Strip all ANSI codes from the colored version and compare visible text
    const stripped = coloredOutput.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe(plainOutput);
  });
});

// ---------------------------------------------------------------------------
// subsection() color — magenta on TTY, plain on NO_COLOR
// ---------------------------------------------------------------------------

describe("subsection() color", () => {
  let subSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    subSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setQuiet(false);
  });

  afterEach(async () => {
    subSpy.mockRestore();
    setColorMode("clear");
    await resetColor();
    setQuiet(false);
  });

  it("contains magenta ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    subsection("Task");
    const output = subSpy.mock.calls[0][0] as string;
    expect(output).toContain(MAGENTA);
    expect(output).toContain("Task");
  });

  it("is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    subsection("Task");
    const output = subSpy.mock.calls[0][0] as string;
    expect(output).not.toContain(ANSI_PREFIX);
    expect(output).toContain("── Task ");
  });
});

// ---------------------------------------------------------------------------
// Rolling window — TTY in-place rendering and capture
// ---------------------------------------------------------------------------

describe("rolling window", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  async function enableRolling(): Promise<void> {
    // Force color so isColorEnabled() returns true, then override TTY
    process.env.FORCE_COLOR = "1";
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    _overrideTTY(true);
  }

  async function disableRolling(): Promise<void> {
    _overrideTTY(null);
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    resetRollingWindow();
    resetCapturedLines();
  }

  beforeEach(async () => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    setQuiet(false);
    await enableRolling();
  });

  afterEach(async () => {
    writeSpy.mockRestore();
    await disableRolling();
    setQuiet(false);
  });

  // ── TTY mode: stream() uses process.stdout.write, not console.log ─────────

  it("stream() uses process.stdout.write in TTY mode instead of console.log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stream("Agent", "hello");
    expect(logSpy).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("detail() uses process.stdout.write in TTY mode instead of console.log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    detail("timing info");
    expect(logSpy).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  // ── Content is rendered with colorDim wrapping ────────────────────────────

  it("stream() wraps the displayed line in colorDim (dim ANSI) in rolling mode", () => {
    stream("Result", "some output");
    const written = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    // The dim ANSI code should appear around the line content
    expect(written).toContain(DIM);
  });

  it("detail() wraps the displayed line in colorDim in rolling mode", () => {
    detail("1234ms elapsed");
    const written = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toContain(DIM);
  });

  // ── Capture: all lines go to getCapturedLines() ───────────────────────────

  it("stream() captures plain-text lines regardless of rolling mode", async () => {
    resetCapturedLines();
    stream("Agent", "line 1");
    stream("Tool", "line 2");
    const captured = getCapturedLines();
    expect(captured).toHaveLength(2);
    expect(captured[0]).toContain("[Agent]");
    expect(captured[0]).toContain("line 1");
    expect(captured[0]).not.toContain(ANSI_PREFIX); // raw, no ANSI
    expect(captured[1]).toContain("[Tool]");
    expect(captured[1]).toContain("line 2");
  });

  it("detail() captures plain-text lines regardless of rolling mode", async () => {
    resetCapturedLines();
    detail("elapsed: 100ms");
    const captured = getCapturedLines();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain("elapsed: 100ms");
    expect(captured[0]).not.toContain(ANSI_PREFIX);
  });

  // ── Window eviction: oldest line is evicted after 10 ─────────────────────

  it("window holds at most 10 lines and evicts the oldest", () => {
    resetRollingWindow();
    resetCapturedLines();
    for (let i = 1; i <= 12; i++) {
      stream("Agent", `line ${i}`);
    }
    // All 12 lines captured
    expect(getCapturedLines()).toHaveLength(12);

    // The window itself only keeps the last 10.
    // We verify by checking the stdout.write calls: the last redraw should
    // contain lines 3–12 but not lines 1 or 2.
    const allWritten = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(allWritten).toContain("line 12");
    expect(allWritten).toContain("line 11");
    // Lines 1 and 2 should have been evicted from the window — the last
    // redraw writes 10 lines starting from line 3.
    // Find the LAST occurrence of "line 1" vs "line 2" to confirm eviction.
    // After 12 lines, the window contains lines 3-12, so "line 1" and
    // "line 2" do not appear in the final 10-line redraw.
    // We check by scanning the content after the 11th redraw boundary.
    // Simpler: verify captured has 12 but window only redraws 10 lines on
    // the final call (the cursor-up escape precedes 10 line-clear writes).
    const cursorUpCalls = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[") && s.endsWith("A"));
    // After the window fills (>10 lines), cursor-up should reference 10 lines
    const lastCursorUp = cursorUpCalls[cursorUpCalls.length - 1];
    expect(lastCursorUp).toBe("\x1b[10A");
  });

  // ── resetRollingWindow() clears display state but not capture ────────────

  it("resetRollingWindow() clears the window state but preserves captured lines", () => {
    resetCapturedLines();
    stream("Agent", "before reset");
    expect(getCapturedLines()).toHaveLength(1);

    resetRollingWindow();
    // After reset, next redraw starts from a fresh window (no cursor-up on first line)
    writeSpy.mockClear();
    stream("Agent", "after reset");

    const writes = writeSpy.mock.calls.map((c) => String(c[0]));
    // No cursor-up escape because _linesRendered was 0 after reset
    const hasCursorUp = writes.some((s) => s.startsWith("\x1b[") && s.endsWith("A"));
    expect(hasCursorUp).toBe(false);

    // Captured lines still accumulate (not cleared by resetRollingWindow)
    expect(getCapturedLines()).toHaveLength(2);
  });

  // ── resetCapturedLines() clears the capture buffer ───────────────────────

  it("resetCapturedLines() empties the captured buffer", () => {
    resetCapturedLines();
    stream("Agent", "a");
    stream("Tool", "b");
    expect(getCapturedLines()).toHaveLength(2);
    resetCapturedLines();
    expect(getCapturedLines()).toHaveLength(0);
  });

  // ── section() resets the rolling window ──────────────────────────────────

  it("section() resets the rolling window so next stream() starts fresh", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stream("Agent", "pre-section line");
    writeSpy.mockClear();

    section("New Task");

    // After section(), the window is cleared (_linesRendered = 0).
    // The next stream() call should NOT emit a cursor-up escape.
    writeSpy.mockClear();
    stream("Agent", "post-section line");
    const writes = writeSpy.mock.calls.map((c) => String(c[0]));
    const hasCursorUp = writes.some((s) => s.startsWith("\x1b[") && s.endsWith("A"));
    expect(hasCursorUp).toBe(false);

    logSpy.mockRestore();
  });

  // ── Non-TTY fallback: _overrideTTY(false) uses console.log ───────────────

  it("falls back to console.log when TTY is disabled", async () => {
    _overrideTTY(false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeSpy.mockClear();

    stream("Agent", "non-tty line");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    _overrideTTY(true); // restore for afterEach
  });

  // ── Quiet mode suppresses rolling window output ───────────────────────────

  it("stream() is suppressed by quiet mode even in rolling mode", () => {
    setQuiet(true);
    writeSpy.mockClear();
    stream("Agent", "should not appear");
    expect(writeSpy).not.toHaveBeenCalled();
  });

  // ── Multi-line messages: visual line counting ─────────────────────────────

  it("a message with 2 embedded newlines occupies 3 visual rows (N+1 rule)", () => {
    resetRollingWindow();
    writeSpy.mockClear();
    stream("Agent", "row1\nrow2\nrow3");
    // _redrawWindow writes one \x1b[2K+content per window entry.
    // With 3 physical lines, we expect 3 clear+write calls.
    const lineWrites = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[2K"));
    expect(lineWrites).toHaveLength(3);
    // _linesRendered should be 3; the next stream() cursor-up reflects that.
    writeSpy.mockClear();
    stream("Agent", "next");
    const cursorUps = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[") && s.endsWith("A"));
    expect(cursorUps[0]).toBe("\x1b[3A");
  });

  it("multi-line message is capped so window never exceeds 10 visual rows", () => {
    resetRollingWindow();
    resetCapturedLines();
    // Push 8 single-line messages, then 1 message with 5 lines (total attempt: 13 rows).
    for (let i = 0; i < 8; i++) stream("Agent", `single ${i}`);
    stream("Agent", "ml1\nml2\nml3\nml4\nml5");
    // Window must cap at 10 rows; cursor-up on the next write must be ≤ 10.
    writeSpy.mockClear();
    stream("Agent", "probe");
    const cursorUps = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[") && s.endsWith("A"));
    const rowCount = parseInt(cursorUps[0].slice(2, -1), 10);
    expect(rowCount).toBeLessThanOrEqual(10);
  });

  it("single-line-only runs produce identical cursor-up values as before the fix", () => {
    resetRollingWindow();
    writeSpy.mockClear();
    // Push 12 single-line messages. Window fills at 10; last cursor-up = 10A.
    for (let i = 1; i <= 12; i++) stream("Agent", `line ${i}`);
    const cursorUps = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[") && s.endsWith("A"));
    const lastCursorUp = cursorUps[cursorUps.length - 1];
    expect(lastCursorUp).toBe("\x1b[10A");
  });

  it("multi-line message captured as one raw entry per physical line", () => {
    resetCapturedLines();
    stream("Agent", "line1\nline2\nline3");
    const captured = getCapturedLines();
    expect(captured).toHaveLength(3);
    expect(captured[0]).toContain("line1");
    expect(captured[1]).toBe("line2");
    expect(captured[2]).toBe("line3");
  });

  // ── AC: regression tests for multi-line scroll window behaviour ───────────

  it("4-line message followed by 3 single-line messages produces exactly 7 rendered lines", () => {
    // AC: feeding a 4-line message (3 embedded \n) then 3 single-line messages
    // must yield a window of exactly 7 rows — no more, no less.
    resetRollingWindow();
    stream("Agent", "ml1\nml2\nml3\nml4"); // 4 physical lines
    stream("Agent", "single1");
    stream("Agent", "single2");
    writeSpy.mockClear();
    stream("Agent", "single3"); // triggers a 7-row redraw
    const lineWrites = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[2K"));
    expect(lineWrites).toHaveLength(7);
  });

  it("a single message with 15 newlines is capped to the 10-line window bound", () => {
    // AC: one message with 15 newlines = 16 physical lines; window must cap at 10.
    resetRollingWindow();
    const bigMessage = Array.from({ length: 16 }, (_, i) => `line${i}`).join("\n");
    stream("Agent", bigMessage);
    // Window stabilises at 10; cursor-up on the next call proves the size.
    writeSpy.mockClear();
    stream("Agent", "probe");
    const cursorUps = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[") && s.endsWith("A"));
    expect(cursorUps[0]).toBe("\x1b[10A");
  });

  it("mixed single- and multi-line messages never produce a rendered frame exceeding 10 lines", () => {
    // AC: any sequence of mixed message types must keep every redraw ≤ 10 rows.
    resetRollingWindow();
    const inputs = [
      "a\nb",           // 2 lines → window: 2
      "c",              // 1 line  → window: 3
      "d\ne\nf",        // 3 lines → window: 6
      "g",              // 1 line  → window: 7
      "h\ni\nj\nk\nl",  // 5 lines → window: 10 (cap hit)
      "m",              // 1 line  → window: 10 (eviction)
      "n\no",           // 2 lines → window: 10 (eviction)
      "p",              // 1 line  → window: 10 (eviction)
    ];
    let maxRows = 0;
    for (const input of inputs) {
      writeSpy.mockClear();
      stream("Agent", input);
      const rowsThisRedraw = writeSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.startsWith("\x1b[2K")).length;
      if (rowsThisRedraw > maxRows) maxRows = rowsThisRedraw;
    }
    expect(maxRows).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// getCapturedLines() in non-TTY mode (plain streaming path)
// ---------------------------------------------------------------------------

describe("getCapturedLines() in non-TTY mode", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    setQuiet(false);
    resetRollingWindow();
    resetCapturedLines();
    // Ensure rolling mode is OFF (no TTY override, default env)
    _overrideTTY(false);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    _overrideTTY(null);
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    resetCapturedLines();
    setQuiet(false);
  });

  it("stream() captures plain-text lines in non-TTY mode", () => {
    stream("Agent", "hello");
    stream("Tool", "read_file(...)");
    const captured = getCapturedLines();
    expect(captured).toHaveLength(2);
    expect(captured[0]).toContain("[Agent]");
    expect(captured[1]).toContain("[Tool]");
  });

  it("detail() captures plain-text lines in non-TTY mode", () => {
    detail("50ms");
    const captured = getCapturedLines();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain("50ms");
  });

  it("captured lines contain no ANSI codes in non-TTY mode", () => {
    stream("Agent", "clean text");
    const captured = getCapturedLines();
    expect(captured[0]).not.toContain(ANSI_PREFIX);
  });
});

// ---------------------------------------------------------------------------
// ANSI reset — no color bleed across line boundaries
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";

describe("ANSI color reset — no inter-line bleed", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    process.env.FORCE_COLOR = "1";
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Non-rolling mode so console.log is used
    _overrideTTY(false);
    setQuiet(false);
  });

  afterEach(async () => {
    spy.mockRestore();
    _overrideTTY(null);
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    resetCapturedLines();
    setQuiet(false);
  });

  // ── Multi-line [Agent] text — each physical line must carry its own reset ──

  // colorInfo uses \x1b[39m (fg reset) not \x1b[0m. Any of these are valid
  // ANSI reset codes: 0 (full), 39 (fg), 22 (bold/dim). The requirement is
  // that every colored physical line ends with SOME reset so no color bleeds
  // into the next console.log call.
  const ANSI_RESET_RE = /\x1b\[(?:0|39|22)m$/;

  it("[Agent] multi-line text: first physical line ends with a reset before \\n", () => {
    stream("Agent", "line one\nline two");
    const output = spy.mock.calls[0][0] as string;
    // Split on the embedded newline; the first segment must end with a reset
    const segments = output.split("\n");
    expect(segments[0]).toMatch(ANSI_RESET_RE);
  });

  it("[Agent] multi-line text: second physical line starts a fresh color open", () => {
    stream("Agent", "first\nsecond");
    const output = spy.mock.calls[0][0] as string;
    const segments = output.split("\n");
    // The second segment must have its own ANSI code (not rely on the first line's)
    expect(segments[1]).toContain(ANSI_PREFIX);
  });

  it("[Agent] multi-line text: every physical line ends with a reset code", () => {
    stream("Agent", "a\nb\nc");
    const output = spy.mock.calls[0][0] as string;
    const segments = output.split("\n").filter((s) => s.length > 0);
    for (const seg of segments) {
      // Every colored segment must close its own color — no dangling open codes
      expect(seg).toMatch(ANSI_RESET_RE);
    }
  });

  it("[claude] vendor label: bracket cyan is reset before the text body", () => {
    // Regression: [claude] bracket is colorInfo (cyan). The \x1b[39m reset must
    // appear immediately after the bracket so the text body is not rendered in
    // cyan. Without the fix, the text body inherits the active cyan color.
    stream("claude", "some model text");
    const output = spy.mock.calls[0][0] as string;
    // Verify the bracket's cyan is reset before the text body.
    // colorInfo("[claude]") = \x1b[36m[claude]\x1b[39m, so after splitting on
    // "[claude]" the remainder must start with the \x1b[39m reset.
    const afterBracket = output.split("[claude]")[1] ?? "";
    expect(afterBracket).toMatch(/^\x1b\[39m/);
  });
});

// ---------------------------------------------------------------------------
// ANSI reset — rolling window line termination
// ---------------------------------------------------------------------------

describe("ANSI reset — rolling window line termination", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    process.env.FORCE_COLOR = "1";
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    _overrideTTY(true);
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    resetRollingWindow();
    resetCapturedLines();
    setQuiet(false);
  });

  afterEach(async () => {
    writeSpy.mockRestore();
    _overrideTTY(null);
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    resetRollingWindow();
    resetCapturedLines();
    setQuiet(false);
  });

  it("every line written by _redrawWindow ends with \\x1b[0m before the newline", () => {
    stream("claude", "output from model");
    const lineWrites = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[2K"));
    expect(lineWrites.length).toBeGreaterThan(0);
    for (const write of lineWrites) {
      // Each redraw write must end with reset + newline
      expect(write).toMatch(/\x1b\[0m\n$/);
    }
  });

  it("multi-line [claude] text: all window line writes end with \\x1b[0m", () => {
    stream("claude", "line1\nline2\nline3");
    const lineWrites = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[2K"));
    // 3 physical lines → at least 3 line-clear writes on the final redraw
    expect(lineWrites.length).toBeGreaterThanOrEqual(3);
    for (const write of lineWrites) {
      expect(write).toMatch(/\x1b\[0m\n$/);
    }
  });

  it("truncation appends \\x1b[0m so cut lines do not bleed color", () => {
    // Force a very narrow column so any stream() call triggers truncation
    Object.defineProperty(process.stdout, "columns", { value: 10, configurable: true });
    stream("Agent", "this is a very long line that will definitely be truncated");
    Object.defineProperty(process.stdout, "columns", { value: undefined, configurable: true });

    const lineWrites = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[2K"));
    for (const write of lineWrites) {
      // Truncated or not, every line must end with \x1b[0m\n
      expect(write).toMatch(/\x1b\[0m\n$/);
    }
  });
});
