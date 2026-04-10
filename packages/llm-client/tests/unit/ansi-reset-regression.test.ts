/**
 * Regression tests: every colorized string returned by the shared color utility
 * must end with an ANSI reset code.
 *
 * These tests act as a ratchet against dropped reset codes. If a contributor
 * modifies help-format.ts to omit a trailing reset — or adds a new color
 * function without one — these tests fail before the change reaches CI.
 *
 * Semantic reset codes used by the implementation:
 *   \x1b[22m — bold/dim intensity reset
 *   \x1b[39m — foreground color reset
 *   \x1b[0m  — full reset (truncation helpers)
 *
 * Separate coverage lives in help-format.test.ts (exact-string assertions).
 * This file focuses on the reset-is-present invariant across all functions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resetColorCache,
  bold,
  dim,
  cyan,
  yellow,
  green,
  red,
  magenta,
  colorSuccess,
  colorError,
  colorWarn,
  colorPending,
  colorInfo,
  colorDim,
  colorPink,
  colorStatus,
} from "../../src/help-format.js";

// ── assertion helpers ─────────────────────────────────────────────────────────

/** ANSI reset codes emitted by the implementation. */
const RESET_CODES = ["\x1b[0m", "\x1b[22m", "\x1b[39m", "\x1b[49m"];

function containsAnsi(s: string): boolean {
  return s.includes("\x1b[");
}

function endsWithReset(s: string): boolean {
  return RESET_CODES.some((r) => s.endsWith(r));
}

/**
 * Assert: if the string contains ANSI codes it must end with a reset code.
 * Fails with a message showing the bad suffix so the breakage is obvious.
 */
function assertEndsWithReset(s: string, label: string): void {
  if (!containsAnsi(s)) return; // plain-text path is always safe
  expect(
    endsWithReset(s),
    `${label} → ends with ${JSON.stringify(s.slice(-12))} — expected reset code`,
  ).toBe(true);
}

// ── env helpers ───────────────────────────────────────────────────────────────

function setupForceColor(): void {
  beforeEach(() => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetColorCache();
  });
  afterEach(() => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    resetColorCache();
  });
}

function setupNoColor(): void {
  beforeEach(() => {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    resetColorCache();
  });
  afterEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    resetColorCache();
  });
}

// ── primitives — FORCE_COLOR ──────────────────────────────────────────────────

describe("color primitives — FORCE_COLOR reset regression", () => {
  setupForceColor();

  const CASES: [string, (s: string) => string][] = [
    ["bold", bold],
    ["dim", dim],
    ["cyan", cyan],
    ["yellow", yellow],
    ["green", green],
    ["red", red],
    ["magenta", magenta],
  ];

  for (const [name, fn] of CASES) {
    it(`${name}() is colorized and ends with a reset code`, () => {
      const out = fn("sample");
      expect(containsAnsi(out)).toBe(true); // color IS applied
      assertEndsWithReset(out, name);        // reset IS present
    });
  }

  // Verify the specific semantic reset codes (not just any ANSI suffix).
  // These pin the intent: intensity helpers use intensity-reset, not full-reset.
  it("bold uses intensity-reset \\x1b[22m", () => {
    expect(bold("x")).toMatch(/\x1b\[22m$/);
  });

  it("dim uses intensity-reset \\x1b[22m", () => {
    expect(dim("x")).toMatch(/\x1b\[22m$/);
  });

  it("cyan uses foreground-reset \\x1b[39m", () => {
    expect(cyan("x")).toMatch(/\x1b\[39m$/);
  });

  it("yellow uses foreground-reset \\x1b[39m", () => {
    expect(yellow("x")).toMatch(/\x1b\[39m$/);
  });

  it("green uses foreground-reset \\x1b[39m", () => {
    expect(green("x")).toMatch(/\x1b\[39m$/);
  });

  it("red uses foreground-reset \\x1b[39m", () => {
    expect(red("x")).toMatch(/\x1b\[39m$/);
  });

  it("magenta uses foreground-reset \\x1b[39m", () => {
    expect(magenta("x")).toMatch(/\x1b\[39m$/);
  });
});

// ── semantic helpers — FORCE_COLOR ───────────────────────────────────────────

describe("semantic helpers — FORCE_COLOR reset regression", () => {
  setupForceColor();

  const SEMANTIC: [string, (s: string) => string, string][] = [
    ["colorSuccess", colorSuccess, "done"],
    ["colorError", colorError, "failed"],
    ["colorWarn", colorWarn, "caution"],
    ["colorPending", colorPending, "running"],
    ["colorInfo", colorInfo, "note"],
    ["colorDim", colorDim, "hint"],
    ["colorPink", colorPink, "─".repeat(20)],
  ];

  for (const [name, fn, sample] of SEMANTIC) {
    it(`${name}("${sample.slice(0, 10)}") is colorized and ends with a reset code`, () => {
      const out = fn(sample);
      expect(containsAnsi(out)).toBe(true);
      assertEndsWithReset(out, name);
    });
  }

  const STATUSES = [
    "completed", "in_progress", "pending", "blocked", "failing",
    "failed", "timeout", "budget_exceeded", "deferred", "deleted",
    "running", "success", "error", "warn",
  ];

  for (const status of STATUSES) {
    it(`colorStatus("${status}") ends with a reset code`, () => {
      const out = colorStatus(status);
      expect(containsAnsi(out)).toBe(true);
      assertEndsWithReset(out, `colorStatus("${status}")`);
    });
  }

  it("colorStatus() with display-text override ends with a reset code", () => {
    const out = colorStatus("completed", "✓ done");
    expect(containsAnsi(out)).toBe(true);
    assertEndsWithReset(out, "colorStatus(completed, '✓ done')");
  });
});

// ── NO_COLOR — no ANSI codes emitted ─────────────────────────────────────────

describe("NO_COLOR path — all color functions return unmodified text", () => {
  setupNoColor();

  const ALL: [string, (s: string) => string][] = [
    ["bold", bold], ["dim", dim], ["cyan", cyan], ["yellow", yellow],
    ["green", green], ["red", red], ["magenta", magenta],
    ["colorSuccess", colorSuccess], ["colorError", colorError],
    ["colorWarn", colorWarn], ["colorPending", colorPending],
    ["colorInfo", colorInfo], ["colorDim", colorDim], ["colorPink", colorPink],
  ];

  for (const [name, fn] of ALL) {
    it(`${name}() → no ANSI codes, returns input unchanged`, () => {
      expect(fn("test")).toBe("test");
      expect(containsAnsi(fn("test"))).toBe(false);
    });
  }

  it("colorStatus() → no ANSI codes for all known statuses", () => {
    for (const s of ["completed", "failing", "pending", "deferred", "in_progress"]) {
      expect(containsAnsi(colorStatus(s))).toBe(false);
      expect(colorStatus(s)).toBe(s);
    }
  });
});

// ── non-TTY — no ANSI codes emitted ──────────────────────────────────────────

describe("non-TTY path — color functions return unmodified text", () => {
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
      configurable: true,
    });
    resetColorCache();
  });

  afterEach(() => {
    if (origIsTTY === undefined) {
      // @ts-expect-error — restoring undefined for test isolation
      delete process.stdout.isTTY;
    } else {
      Object.defineProperty(process.stdout, "isTTY", {
        value: origIsTTY,
        writable: true,
        configurable: true,
      });
    }
    resetColorCache();
  });

  it("all primitive helpers return plain text", () => {
    for (const fn of [bold, dim, cyan, yellow, green, red, magenta]) {
      expect(containsAnsi(fn("t"))).toBe(false);
    }
  });

  it("all semantic helpers return plain text", () => {
    for (const fn of [colorSuccess, colorError, colorWarn, colorPending, colorInfo, colorDim, colorPink]) {
      expect(containsAnsi(fn("t"))).toBe(false);
    }
  });

  it("colorStatus() returns plain text for all statuses", () => {
    for (const s of ["completed", "failing", "pending", "deferred", "running"]) {
      expect(containsAnsi(colorStatus(s))).toBe(false);
    }
  });
});
