import { describe, it, expect, afterEach } from "vitest";

/**
 * Verify that run-loop status messages use semantic color helpers and honour
 * TTY / NO_COLOR conventions.
 *
 * `formatPauseMessage` and `formatRunSuccessMessage` are the single place in
 * run.ts that wraps these strings in color. Testing them directly confirms
 * that the correct semantic helpers (colorWarn / colorSuccess) are applied —
 * any future accidental switch to a raw primitive would break these assertions.
 */

// ANSI escape codes we assert on
const YELLOW   = "\x1b[33m";
const GREEN    = "\x1b[32m";
const ANSI_PREFIX = "\x1b[";

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Reset the llm-client color cache so env-var changes take effect.
 * We import it from @n-dx/llm-client rather than the hench gateway because
 * these tests exercise the ANSI output, not the gateway re-export surface.
 */
async function resetColor() {
  const { resetColorCache } = await import("@n-dx/llm-client");
  resetColorCache();
}

function setColorMode(mode: "force" | "none" | "clear") {
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

// ── inter-task / inter-epic pause message ─────────────────────────────────

describe("formatPauseMessage", () => {
  afterEach(async () => {
    setColorMode("clear");
    await resetColor();
  });

  it("contains yellow ANSI code when color is forced (task)", async () => {
    setColorMode("force");
    await resetColor();
    const { formatPauseMessage } = await import("../../../../src/cli/commands/run.js");
    const msg = formatPauseMessage(2000, "task");
    expect(msg).toContain(YELLOW);
  });

  it("contains yellow ANSI code when color is forced (epic)", async () => {
    setColorMode("force");
    await resetColor();
    const { formatPauseMessage } = await import("../../../../src/cli/commands/run.js");
    const msg = formatPauseMessage(500, "epic");
    expect(msg).toContain(YELLOW);
  });

  it("contains the pause duration in the message", async () => {
    setColorMode("clear");
    await resetColor();
    const { formatPauseMessage } = await import("../../../../src/cli/commands/run.js");
    const msg = formatPauseMessage(3000, "task");
    expect(msg).toContain("3000ms");
    expect(msg).toContain("next task");
  });

  it("is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    const { formatPauseMessage } = await import("../../../../src/cli/commands/run.js");
    const msg = formatPauseMessage(2000, "task");
    expect(msg).not.toContain(ANSI_PREFIX);
    expect(msg).toBe("Pausing 2000ms before next task...");
  });

  it("is plain text (no ANSI) when NO_COLOR=1 for epic", async () => {
    setColorMode("none");
    await resetColor();
    const { formatPauseMessage } = await import("../../../../src/cli/commands/run.js");
    const msg = formatPauseMessage(1500, "epic");
    expect(msg).not.toContain(ANSI_PREFIX);
    expect(msg).toBe("Pausing 1500ms before next epic...");
  });
});

// ── no-actionable-tasks advisory block ───────────────────────────────────

describe("formatNoActionableTasksWarning", () => {
  afterEach(async () => {
    setColorMode("clear");
    await resetColor();
  });

  it("all three lines contain yellow ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    const { formatNoActionableTasksWarning } = await import("../../../../src/cli/commands/run.js");
    const lines = formatNoActionableTasksWarning("Build Features", 3);
    for (const line of lines) {
      expect(line).toContain(YELLOW);
    }
  });

  it("all three lines are plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    const { formatNoActionableTasksWarning } = await import("../../../../src/cli/commands/run.js");
    const lines = formatNoActionableTasksWarning("Build Features", 3);
    for (const line of lines) {
      expect(line).not.toContain(ANSI_PREFIX);
    }
  });

  it("first line contains the epic title", async () => {
    setColorMode("clear");
    await resetColor();
    const { formatNoActionableTasksWarning } = await import("../../../../src/cli/commands/run.js");
    const [line1] = formatNoActionableTasksWarning("My Epic Title", 5);
    expect(line1).toContain("My Epic Title");
  });

  it("second line contains the blocked task count", async () => {
    setColorMode("clear");
    await resetColor();
    const { formatNoActionableTasksWarning } = await import("../../../../src/cli/commands/run.js");
    const [, line2] = formatNoActionableTasksWarning("Some Epic", 7);
    expect(line2).toContain("7");
    expect(line2).toContain("blocked or deferred");
  });

  it("third line contains the rex status hint", async () => {
    setColorMode("clear");
    await resetColor();
    const { formatNoActionableTasksWarning } = await import("../../../../src/cli/commands/run.js");
    const [, , line3] = formatNoActionableTasksWarning("Some Epic", 2);
    expect(line3).toContain("rex status");
    expect(line3).toContain("rex update");
  });

  it("returns exactly three lines", async () => {
    setColorMode("clear");
    await resetColor();
    const { formatNoActionableTasksWarning } = await import("../../../../src/cli/commands/run.js");
    const lines = formatNoActionableTasksWarning("Epic", 0);
    expect(lines).toHaveLength(3);
  });
});

// ── run-loop success / completion message ─────────────────────────────────

describe("formatRunSuccessMessage", () => {
  afterEach(async () => {
    setColorMode("clear");
    await resetColor();
  });

  it("contains green ANSI code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    const { formatRunSuccessMessage } = await import("../../../../src/cli/commands/run.js");
    const msg = formatRunSuccessMessage("✓ All epics are complete.");
    expect(msg).toContain(GREEN);
  });

  it("preserves the message text inside the ANSI wrapper", async () => {
    setColorMode("force");
    await resetColor();
    const { formatRunSuccessMessage } = await import("../../../../src/cli/commands/run.js");
    const text = "✓ All epics are complete.";
    const msg = formatRunSuccessMessage(text);
    expect(msg).toContain(text);
  });

  it("is plain text (no ANSI) when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    const { formatRunSuccessMessage } = await import("../../../../src/cli/commands/run.js");
    const text = "✓ All epics are complete.";
    const msg = formatRunSuccessMessage(text);
    expect(msg).not.toContain(ANSI_PREFIX);
    expect(msg).toBe(text);
  });

  it("is plain text (no ANSI) for epic-specific success message when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    const { formatRunSuccessMessage } = await import("../../../../src/cli/commands/run.js");
    const text = "✓ All tasks in epic \"Build Features\" are complete.";
    const msg = formatRunSuccessMessage(text);
    expect(msg).not.toContain(ANSI_PREFIX);
    expect(msg).toBe(text);
  });
});

// ── iteration boundary banner ─────────────────────────────────────────────

describe("formatIterationBanner", () => {
  afterEach(async () => {
    setColorMode("clear");
    await resetColor();
  });

  it("includes n/total format for fixed-iteration mode", async () => {
    setColorMode("none");
    await resetColor();
    const { formatIterationBanner } = await import("../../../../src/cli/commands/run.js");
    const banner = formatIterationBanner(2, 5);
    expect(banner).toContain("2/5");
    expect(banner).toContain("Iteration");
  });

  it("includes n-only format for unbounded loop mode", async () => {
    setColorMode("none");
    await resetColor();
    const { formatIterationBanner } = await import("../../../../src/cli/commands/run.js");
    const banner = formatIterationBanner(3);
    expect(banner).toContain("3");
    expect(banner).not.toMatch(/\d+\/\d+/);
    expect(banner).toContain("Iteration");
  });

  it("matches the === Iteration n/total === template exactly (plain text)", async () => {
    setColorMode("none");
    await resetColor();
    const { formatIterationBanner } = await import("../../../../src/cli/commands/run.js");
    expect(formatIterationBanner(1, 3)).toBe("=== Iteration 1/3 ===");
  });

  it("matches the === Iteration n === template exactly (plain text, unbounded)", async () => {
    setColorMode("none");
    await resetColor();
    const { formatIterationBanner } = await import("../../../../src/cli/commands/run.js");
    expect(formatIterationBanner(2)).toBe("=== Iteration 2 ===");
  });

  it("respects NO_COLOR — bold() degrades to plain text", async () => {
    setColorMode("none");
    await resetColor();
    const { formatIterationBanner } = await import("../../../../src/cli/commands/run.js");
    const banner = formatIterationBanner(1, 2);
    expect(banner).not.toContain(ANSI_PREFIX);
  });

  it("contains ANSI bold code when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    const { formatIterationBanner } = await import("../../../../src/cli/commands/run.js");
    const banner = formatIterationBanner(1, 2);
    // bold() emits ESC[1m
    expect(banner).toContain("\x1b[1m");
  });
});

// ── loop-iteration boundary separator ────────────────────────────────────

describe("formatLoopIterationSeparator", () => {
  afterEach(async () => {
    setColorMode("clear");
    await resetColor();
  });

  it("contains yellow ANSI code when color is forced (TTY mode)", async () => {
    setColorMode("force");
    await resetColor();
    const { formatLoopIterationSeparator } = await import("../../../../src/cli/commands/run.js");
    const sep = formatLoopIterationSeparator();
    expect(sep).toContain(YELLOW);
  });

  it("is 60 separator characters wide (excluding ANSI codes)", async () => {
    setColorMode("none");
    await resetColor();
    const { formatLoopIterationSeparator } = await import("../../../../src/cli/commands/run.js");
    const sep = formatLoopIterationSeparator();
    // With NO_COLOR the string is plain text — all 60 ─ characters, no ANSI
    expect(sep).toBe("─".repeat(60));
  });

  it("is plain text (no ANSI codes) when NO_COLOR=1 — call site must suppress entirely", async () => {
    setColorMode("none");
    await resetColor();
    const { formatLoopIterationSeparator } = await import("../../../../src/cli/commands/run.js");
    const sep = formatLoopIterationSeparator();
    expect(sep).not.toContain(ANSI_PREFIX);
  });

  it("isColorEnabled() returns false under NO_COLOR=1 — so the separator is not emitted", async () => {
    setColorMode("none");
    await resetColor();
    // Verify the guard condition: when isColorEnabled() is false the call site
    // skips emission entirely (no characters, no newline artifact).
    const { isColorEnabled } = await import("@n-dx/llm-client");
    expect(isColorEnabled()).toBe(false);
  });

  it("isColorEnabled() returns true under FORCE_COLOR=1 — so the separator IS emitted", async () => {
    setColorMode("force");
    await resetColor();
    const { isColorEnabled } = await import("@n-dx/llm-client");
    expect(isColorEnabled()).toBe(true);
  });
});
