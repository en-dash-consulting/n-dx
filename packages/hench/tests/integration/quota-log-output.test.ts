/**
 * Integration test for quota log output wiring.
 *
 * Verifies the full output path:
 *   checkQuotaRemaining() → formatQuotaLog() → info() → console.log
 *
 * Tests confirm that:
 * - Quota lines appear in normal mode with correct ANSI color for thresholds
 * - Quota lines are suppressed in quiet mode (--quiet flag)
 * - No output is emitted when checkQuotaRemaining() returns an empty array
 * - A degraded indicator is printed instead of crashing when the fetch fails
 *
 * @see packages/hench/src/cli/commands/run.ts — emitQuotaLog()
 * @see packages/hench/src/quota/index.ts — checkQuotaRemaining()
 * @see packages/hench/src/quota/format.ts — formatQuotaLog()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ANSI escape code constants mirrored from the formatter for readable assertions.
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// Mock the quota module to control what checkQuotaRemaining() returns.
// The real formatQuotaLog() is preserved via importOriginal so that
// threshold and color assertions reflect the real implementation.
vi.mock("../../src/quota/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/quota/index.js")>();
  return {
    ...actual,
    checkQuotaRemaining: vi.fn().mockResolvedValue([]),
  };
});

describe("quota log output integration", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    // Reset quiet state after every test so tests are independent.
    const { setQuiet } = await import("../../src/prd/llm-gateway.js");
    setQuiet(false);
  });

  // ── Helper to get the mocked checkQuotaRemaining ────────────────────────

  async function getMockedCheck() {
    const mod = await import("../../src/quota/index.js");
    return vi.mocked(mod.checkQuotaRemaining);
  }

  // ── Normal mode: lines emitted ──────────────────────────────────────────

  describe("in normal mode (not quiet)", () => {
    it("emits a quota line when checkQuotaRemaining returns data", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([
        { vendor: "claude", model: "claude-opus-4-5", percentRemaining: 42 },
      ]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("claude");
      expect(output).toContain("claude-opus-4-5");
      expect(output).toContain("42%");
      expect(output).toContain("remaining");
    });

    it("applies yellow color at 7 % remaining (5 % ≤ x < 10 % threshold)", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([
        { vendor: "codex", model: "gpt-4o", percentRemaining: 7 },
      ]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain(YELLOW);
      expect(output).not.toContain(RED);
      expect(output).toContain(RESET);
    });

    it("applies yellow color at exactly 5 % (lower yellow threshold)", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([
        { vendor: "claude", model: "claude-opus-4-5", percentRemaining: 5 },
      ]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain(YELLOW);
      expect(output).not.toContain(RED);
    });

    it("applies red color at 3 % remaining (< 5 % threshold)", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([
        { vendor: "claude", model: "claude-sonnet-4-5", percentRemaining: 3 },
      ]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain(RED);
      expect(output).not.toContain(YELLOW);
      expect(output).toContain(RESET);
    });

    it("applies red color at exactly 0 % (exhausted)", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([
        { vendor: "codex", model: "gpt-4o", percentRemaining: 0 },
      ]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain(RED);
      expect(output).not.toContain(YELLOW);
    });

    it("applies no color at 10 % remaining (at green threshold boundary)", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([
        { vendor: "claude", model: "claude-opus-4-5", percentRemaining: 10 },
      ]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).not.toContain(RED);
      expect(output).not.toContain(YELLOW);
      expect(output).not.toContain(RESET);
    });

    it("emits nothing when checkQuotaRemaining returns an empty array", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("emits one line per quota entry", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([
        { vendor: "claude", model: "claude-opus-4-5", percentRemaining: 42 },
        { vendor: "codex", model: "gpt-4o", percentRemaining: 7 },
      ]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ── Quiet mode: lines suppressed ────────────────────────────────────────

  describe("in quiet mode (--quiet)", () => {
    it("suppresses quota output when quiet mode is active", async () => {
      const { setQuiet } = await import("../../src/prd/llm-gateway.js");
      setQuiet(true);

      const mockedCheck = await getMockedCheck();
      mockedCheck.mockResolvedValueOnce([
        { vendor: "claude", model: "claude-opus-4-5", percentRemaining: 42 },
      ]);

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await emitQuotaLog();

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("suppresses the degraded indicator when quiet mode is active", async () => {
      const { setQuiet } = await import("../../src/prd/llm-gateway.js");
      setQuiet(true);

      const mockedCheck = await getMockedCheck();
      mockedCheck.mockRejectedValueOnce(new Error("network error"));

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await expect(emitQuotaLog()).resolves.toBeUndefined();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  // ── Error handling: degraded indicator ──────────────────────────────────

  describe("when checkQuotaRemaining throws", () => {
    it("emits a degraded indicator instead of crashing", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockRejectedValueOnce(new Error("quota fetch failed"));

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await expect(emitQuotaLog()).resolves.toBeUndefined();

      const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("quota: unavailable");
    });

    it("does not re-throw the error", async () => {
      const mockedCheck = await getMockedCheck();
      mockedCheck.mockRejectedValueOnce(new Error("transient failure"));

      const { emitQuotaLog } = await import("../../src/cli/commands/run.js");
      await expect(emitQuotaLog()).resolves.toBeUndefined();
    });
  });
});
