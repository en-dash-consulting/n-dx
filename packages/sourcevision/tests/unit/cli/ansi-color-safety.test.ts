/**
 * Regression guard: sourcevision CLI output must never emit ANSI color codes.
 *
 * Sourcevision does not apply color to its output — its CLI uses the shared
 * `info()` and `result()` primitives from @n-dx/llm-client which are
 * color-agnostic pass-throughs. This test guards against a contributor
 * accidentally adding colored output without proper resets.
 *
 * Coverage:
 *   - info() and result() do not add ANSI codes regardless of FORCE_COLOR.
 *   - NO_COLOR path is also ANSI-free (belt-and-suspenders).
 *   - The output primitives pass text through unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { info, result, setQuiet } from "../../../src/cli/output.js";

function containsAnsi(s: string): boolean {
  return s.includes("\x1b[");
}

// ── FORCE_COLOR — output must still be ANSI-free ──────────────────────────────

describe("sourcevision CLI output — FORCE_COLOR: no ANSI codes in info/result", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    setQuiet(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    setQuiet(false);
  });

  it("info() passes text through without adding ANSI codes", () => {
    info("Analyzing 42 files…");
    expect(logSpy).toHaveBeenCalledWith("Analyzing 42 files…");
    const logged = String(logSpy.mock.calls[0][0]);
    expect(containsAnsi(logged)).toBe(false);
  });

  it("result() passes text through without adding ANSI codes", () => {
    result("zones: 5, files: 100");
    expect(logSpy).toHaveBeenCalledWith("zones: 5, files: 100");
    const logged = String(logSpy.mock.calls[0][0]);
    expect(containsAnsi(logged)).toBe(false);
  });

  it("multi-line info() output contains no ANSI codes on any line", () => {
    const lines = [
      "Zone: web-viewer (12 files)",
      "Zone: web-server (8 files)",
      "Zone: web-shared (3 files)",
    ];
    for (const line of lines) {
      info(line);
    }
    for (const call of logSpy.mock.calls) {
      const logged = String(call[0]);
      expect(containsAnsi(logged)).toBe(false);
    }
  });

  it("result() with JSON-like output contains no ANSI codes", () => {
    result(JSON.stringify({ zones: 5, cohesion: 0.72 }));
    const logged = String(logSpy.mock.calls[0][0]);
    expect(containsAnsi(logged)).toBe(false);
  });
});

// ── NO_COLOR path ─────────────────────────────────────────────────────────────

describe("sourcevision CLI output — NO_COLOR path: no ANSI codes", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    setQuiet(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    setQuiet(false);
  });

  it("info() contains no ANSI codes under NO_COLOR", () => {
    info("Inventory complete");
    const logged = String(logSpy.mock.calls[0][0]);
    expect(containsAnsi(logged)).toBe(false);
  });

  it("result() contains no ANSI codes under NO_COLOR", () => {
    result("Analysis complete. 0 errors.");
    const logged = String(logSpy.mock.calls[0][0]);
    expect(containsAnsi(logged)).toBe(false);
  });
});

// ── quiet mode ────────────────────────────────────────────────────────────────

describe("sourcevision CLI output — quiet mode suppresses info()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    setQuiet(true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    setQuiet(false);
  });

  it("info() is suppressed in quiet mode", () => {
    info("suppressed");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("result() is NOT suppressed in quiet mode", () => {
    result("essential output");
    expect(logSpy).toHaveBeenCalledWith("essential output");
  });
});
