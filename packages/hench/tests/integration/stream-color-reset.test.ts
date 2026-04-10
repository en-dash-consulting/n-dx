/**
 * Integration regression tests: hench stream() and detail() output lines must
 * not cause ANSI color bleed across terminal lines.
 *
 * These tests guard against the class of bug where a colored segment is opened
 * on one line and the reset only arrives on a later line, inheriting the color.
 *
 * Two rendering paths are exercised:
 *
 * 1. Non-TTY + FORCE_COLOR: stream/detail emit via console.log().
 *    Each argument to console.log is checked for unclosed ANSI state.
 *
 * 2. TTY + FORCE_COLOR (rolling window): stream/detail emit via
 *    process.stdout.write(). Each write must contain \x1b[0m before the
 *    trailing \n so the window's clear-and-rewrite cycle is color-safe.
 *
 * Multi-line content (strings with embedded \n) is also verified:
 * each physical line segment must independently close its ANSI state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  stream,
  detail,
  resetRollingWindow,
  resetCapturedLines,
} from "../../src/cli/output.js";
import { _overrideTTY } from "../../src/types/output.js";

// ── ANSI state tracker ────────────────────────────────────────────────────────

/**
 * Returns true if the string leaves the terminal in a non-default state.
 * Tracks foreground-color and bold/dim intensity codes independently.
 */
function hasUnclosedAnsi(s: string): boolean {
  let openColor = false;
  let openIntensity = false;

  const ANSI_RE = /\x1b\[(\d+(?:;\d+)*)m/g;
  let match: RegExpExecArray | null;

  while ((match = ANSI_RE.exec(s)) !== null) {
    for (const part of match[1].split(";")) {
      const code = parseInt(part, 10);
      if (code === 0) {
        openColor = false;
        openIntensity = false;
      } else if (code === 22 || code === 23) {
        openIntensity = false;
      } else if (code === 39 || code === 49) {
        openColor = false;
      } else if (code === 1 || code === 2 || code === 3) {
        openIntensity = true;
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97) || (code >= 40 && code <= 47)) {
        openColor = true;
      }
    }
  }

  return openColor || openIntensity;
}

// ── non-TTY + FORCE_COLOR tests ───────────────────────────────────────────────

describe("hench stream() — non-TTY FORCE_COLOR: no color bleed per line", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    _overrideTTY(false); // force non-TTY rendering (console.log path)
    resetRollingWindow();
    resetCapturedLines();
  });

  afterEach(async () => {
    logSpy.mockRestore();
    _overrideTTY(null);
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    resetRollingWindow();
    resetCapturedLines();
  });

  it("stream('Agent', text) — each physical line has no unclosed ANSI", () => {
    stream("Agent", "running test suite");
    expect(logSpy).toHaveBeenCalled();
    const logged = String(logSpy.mock.calls[0][0]);
    for (const segment of logged.split("\n")) {
      expect(hasUnclosedAnsi(segment)).toBe(false);
    }
  });

  it("stream('Tool', text) — each physical line has no unclosed ANSI", () => {
    stream("Tool", "read_file({path: 'src/index.ts'})");
    expect(logSpy).toHaveBeenCalled();
    const logged = String(logSpy.mock.calls[0][0]);
    for (const segment of logged.split("\n")) {
      expect(hasUnclosedAnsi(segment)).toBe(false);
    }
  });

  it("stream('claude', text) — each physical line has no unclosed ANSI", () => {
    stream("claude", "I'll read the file now.");
    expect(logSpy).toHaveBeenCalled();
    const logged = String(logSpy.mock.calls[0][0]);
    for (const segment of logged.split("\n")) {
      expect(hasUnclosedAnsi(segment)).toBe(false);
    }
  });

  it("stream('Result', text) — label without color entry has no unclosed ANSI", () => {
    stream("Result", "exit code: 0");
    expect(logSpy).toHaveBeenCalled();
    const logged = String(logSpy.mock.calls[0][0]);
    for (const segment of logged.split("\n")) {
      expect(hasUnclosedAnsi(segment)).toBe(false);
    }
  });

  it("stream('Agent', multi-line text) — every physical line is safe", () => {
    // Multi-line Agent text: stream() splits on \n and colors each line
    // individually via colorInfo so each segment carries its own open+close pair.
    stream("Agent", "step 1: read file\nstep 2: analyse\nstep 3: write patch");
    expect(logSpy).toHaveBeenCalled();
    const logged = String(logSpy.mock.calls[0][0]);
    const segments = logged.split("\n");
    expect(segments.length).toBeGreaterThan(1); // confirm multi-line output
    for (const segment of segments) {
      expect(hasUnclosedAnsi(segment)).toBe(false);
    }
  });

  it("stream('Tool', multi-line text) — every physical line is safe", () => {
    // Tool text has no body color, but the label uses colorDim.
    // Only the first segment has the bracket; subsequent segments are plain.
    stream("Tool", "line A\nline B\nline C");
    expect(logSpy).toHaveBeenCalled();
    const logged = String(logSpy.mock.calls[0][0]);
    for (const segment of logged.split("\n")) {
      expect(hasUnclosedAnsi(segment)).toBe(false);
    }
  });

  it("detail(text) — output line has no unclosed ANSI", () => {
    detail("1 234ms elapsed, 0 failures");
    expect(logSpy).toHaveBeenCalled();
    const logged = String(logSpy.mock.calls[0][0]);
    for (const segment of logged.split("\n")) {
      expect(hasUnclosedAnsi(segment)).toBe(false);
    }
  });
});

// ── TTY + FORCE_COLOR (rolling window) ───────────────────────────────────────

describe("hench stream() — TTY rolling window: \\x1b[0m before every \\n", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    _overrideTTY(true); // force TTY rolling-window path
    resetRollingWindow();
    resetCapturedLines();
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
  });

  /** Collect all \x1b[2K-prefixed writes (rendered window rows). */
  function collectWindowRows(): string[] {
    return writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith("\x1b[2K"));
  }

  it("each rolling-window row ends with \\x1b[0m before \\n", () => {
    stream("Agent", "checking build status");
    stream("Tool", "run_shell({cmd: 'pnpm build'})");
    stream("Result", "Build succeeded");
    detail("2 100ms");

    for (const row of collectWindowRows()) {
      // Expected format: \x1b[2K<content>\x1b[0m\n
      expect(
        row.endsWith("\x1b[0m\n"),
        `Rolling window row does not end with \\x1b[0m\\n: ${JSON.stringify(row.slice(-20))}`,
      ).toBe(true);
    }
  });

  it("rolling window rows for multi-line tool output each end with \\x1b[0m\\n", () => {
    const multiLine = Array.from({ length: 5 }, (_, i) => `output line ${i + 1}`).join("\n");
    stream("Result", multiLine);

    const rows = collectWindowRows();
    expect(rows.length).toBeGreaterThan(1); // confirm multiple rows were emitted
    for (const row of rows) {
      expect(row.endsWith("\x1b[0m\n")).toBe(true);
    }
  });

  it("Agent stream rows in rolling window end with \\x1b[0m\\n", () => {
    // Agent rows keep their own colors (yellow bracket + cyan body) rather than
    // being wrapped in colorDim — verify reset is still present.
    stream("Agent", "I will now read the file");
    const rows = collectWindowRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.endsWith("\x1b[0m\n")).toBe(true);
    }
  });
});

// ── NO_COLOR path ─────────────────────────────────────────────────────────────

describe("hench stream() — NO_COLOR path emits no ANSI codes", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    _overrideTTY(false);
    resetRollingWindow();
    resetCapturedLines();
  });

  afterEach(async () => {
    logSpy.mockRestore();
    _overrideTTY(null);
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const { resetColorCache } = await import("@n-dx/llm-client");
    resetColorCache();
    resetRollingWindow();
    resetCapturedLines();
  });

  it("stream('Agent', text) contains no ANSI escape sequences", () => {
    stream("Agent", "running tests");
    const logged = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(logged.includes("\x1b[")).toBe(false);
  });

  it("stream('Tool', text) contains no ANSI escape sequences", () => {
    stream("Tool", "read_file(...)");
    const logged = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(logged.includes("\x1b[")).toBe(false);
  });

  it("detail(text) contains no ANSI escape sequences", () => {
    detail("500ms elapsed");
    const logged = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(logged.includes("\x1b[")).toBe(false);
  });
});
