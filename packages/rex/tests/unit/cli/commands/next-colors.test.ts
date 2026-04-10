/**
 * Integration-level regression tests: rex `next` command output must not
 * produce ANSI color bleed across output lines.
 *
 * These tests reproduce the exact color-formatting patterns used in
 * packages/rex/src/cli/commands/next.ts and verify that:
 *   1. Each formatted line leaves the terminal in its default color state.
 *   2. colorPriority logic (red/yellow/dim for high/medium/low) resets correctly.
 *   3. Breadcrumb joins with dim arrows close the dim before adjacent plain text.
 *   4. NO_COLOR suppresses all ANSI codes.
 *
 * Testing the formatting patterns directly avoids spinning up a real PRD on
 * disk while still exercising the exact code paths that produce CLI output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetColorCache, bold, yellow, red, dim, colorStatus } from "@n-dx/llm-client";

// ── ANSI state tracker ────────────────────────────────────────────────────────

/**
 * Returns true if the string leaves the terminal in a non-default state.
 *
 * Walks every ANSI escape in the string and tracks open/closed state for
 * foreground colors and bold/dim intensity. Returns true if any attribute
 * remains open at the end of the string.
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

// ── colorPriority patterns (from next.ts) ─────────────────────────────────────
//
// next.ts implements:
//   case "high":   return red(priority);
//   case "medium": return yellow(priority);
//   case "low":    return dim(priority);

describe("rex next — colorPriority ANSI reset regression (FORCE_COLOR)", () => {
  setupForceColor();

  it("high priority uses red() which ends with \\x1b[39m", () => {
    const out = red("high");
    expect(out).toMatch(/\x1b\[39m$/);
    expect(hasUnclosedAnsi(out)).toBe(false);
  });

  it("medium priority uses yellow() which ends with \\x1b[39m", () => {
    const out = yellow("medium");
    expect(out).toMatch(/\x1b\[39m$/);
    expect(hasUnclosedAnsi(out)).toBe(false);
  });

  it("low priority uses dim() which ends with \\x1b[22m", () => {
    const out = dim("low");
    expect(out).toMatch(/\x1b\[22m$/);
    expect(hasUnclosedAnsi(out)).toBe(false);
  });

  it("formatted priority output line has no unclosed ANSI", () => {
    // Reproduces:  info(`  Priority: ${colorPriority(item.priority)}`)
    for (const [priority, fn] of [["high", red], ["medium", yellow], ["low", dim]] as const) {
      const line = `  Priority: ${fn(priority)}`;
      expect(hasUnclosedAnsi(line)).toBe(false);
    }
  });
});

// ── colorStatus patterns ──────────────────────────────────────────────────────

describe("rex next — colorStatus ANSI reset regression (FORCE_COLOR)", () => {
  setupForceColor();

  const STATUSES = ["completed", "in_progress", "pending", "failing", "blocked", "deferred"];

  for (const status of STATUSES) {
    it(`formatted status line for "${status}" has no unclosed ANSI`, () => {
      // Reproduces:  info(`  Status: ${colorStatus(item.status)}`)
      const line = `  Status: ${colorStatus(status)}`;
      expect(hasUnclosedAnsi(line)).toBe(false);
    });
  }
});

// ── bold(title) and dim(id) patterns ─────────────────────────────────────────

describe("rex next — title/ID line ANSI reset regression (FORCE_COLOR)", () => {
  setupForceColor();

  it("bold title embedded in line has no unclosed ANSI", () => {
    // Reproduces:  result(`\n[task] ${bold(item.title)}`)
    const line = `[task] ${bold("Implement login flow")}`;
    expect(hasUnclosedAnsi(line)).toBe(false);
  });

  it("dim ID embedded in line has no unclosed ANSI", () => {
    // Reproduces:  result(`  ID:     ${dim(item.id)}`)
    const line = `  ID:     ${dim("abc-1234")}`;
    expect(hasUnclosedAnsi(line)).toBe(false);
  });

  it("combined title + status + priority line has no unclosed ANSI", () => {
    const titleLine = `[task] ${bold("Build auth")}`;
    const statusLine = `  Status: ${colorStatus("in_progress")}`;
    const priorityLine = `  Priority: ${red("high")}`;
    for (const line of [titleLine, statusLine, priorityLine]) {
      expect(hasUnclosedAnsi(line)).toBe(false);
    }
  });
});

// ── breadcrumb join pattern ───────────────────────────────────────────────────

describe("rex next — breadcrumb ANSI reset regression (FORCE_COLOR)", () => {
  setupForceColor();

  it("breadcrumb joined with dim arrows has no unclosed ANSI per physical line", () => {
    // Reproduces:
    //   const breadcrumb = parents.map(p => p.title).join(dim(" → "));
    //   info(dim(breadcrumb + " →"));
    const parents = ["CLI & Developer Tools", "ANSI Color Reset Consistency"];
    const breadcrumb = parents.join(dim(" → "));
    const line = dim(breadcrumb + " →");

    // Check each physical segment (there should be no \n here, but be explicit)
    for (const segment of line.split("\n")) {
      expect(hasUnclosedAnsi(segment)).toBe(false);
    }
  });

  it("single-parent breadcrumb has no unclosed ANSI", () => {
    const line = dim("CLI Tools →");
    expect(hasUnclosedAnsi(line)).toBe(false);
  });

  it("three-level breadcrumb joined with dim arrows has no unclosed ANSI", () => {
    const parents = ["Epic", "Feature", "Task"];
    const breadcrumb = parents.join(dim(" → "));
    const line = dim(breadcrumb + " →");
    expect(hasUnclosedAnsi(line)).toBe(false);
  });
});

// ── NO_COLOR path ─────────────────────────────────────────────────────────────

describe("rex next — NO_COLOR path produces no ANSI codes", () => {
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

  it("colorPriority patterns emit no ANSI under NO_COLOR", () => {
    expect(red("high")).toBe("high");
    expect(yellow("medium")).toBe("medium");
    expect(dim("low")).toBe("low");
  });

  it("formatted output lines are plain text under NO_COLOR", () => {
    const lines = [
      `[task] ${bold("Task title")}`,
      `  ID:     ${dim("abc-1234")}`,
      `  Status: ${colorStatus("pending")}`,
      `  Priority: ${yellow("medium")}`,
    ];
    for (const line of lines) {
      expect(line.includes("\x1b[")).toBe(false);
    }
  });
});
