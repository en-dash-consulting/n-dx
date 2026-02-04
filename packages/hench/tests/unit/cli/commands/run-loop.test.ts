import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../../../src/store/config.js";

/**
 * Tests for the --loop continuous execution mode.
 *
 * These tests exercise the loop control flow in cmdRun by mocking
 * the underlying runOne execution and verifying iteration behaviour,
 * pause timing, and stop conditions.
 */

// We'll test the extracted loop helpers directly rather than cmdRun
// to avoid needing to mock the full agent/CLI stack.

describe("loop mode helpers", () => {
  describe("shouldContinueLoop", () => {
    it("returns true for completed status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("completed")).toBe(true);
    });

    it("returns true for error_transient status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("error_transient")).toBe(true);
    });

    it("returns false for failed status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("failed")).toBe(false);
    });

    it("returns false for timeout status", async () => {
      const { shouldContinueLoop } = await import(
        "../../../../src/cli/commands/run.js"
      );
      expect(shouldContinueLoop("timeout")).toBe(false);
    });
  });

  describe("loopPause", () => {
    it("resolves after the specified delay", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const start = Date.now();
      await loopPause(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timer variance
    });

    it("resolves immediately for 0ms delay", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const start = Date.now();
      await loopPause(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });

    it("can be aborted via AbortSignal", async () => {
      const { loopPause } = await import(
        "../../../../src/cli/commands/run.js"
      );
      const ac = new AbortController();
      const promise = loopPause(10_000, ac.signal);
      // Abort immediately
      ac.abort();
      const start = Date.now();
      await promise;
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(200);
    });
  });
});

describe("stuck task config defaults", () => {
  it("maxFailedAttempts is optional in schema and defaults to 3", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.maxFailedAttempts).toBe(3);
    }
  });

  it("maxFailedAttempts can be customised in config", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: 5 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.maxFailedAttempts).toBe(5);
    }
  });

  it("rejects maxFailedAttempts of 0", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: 0 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });

  it("rejects negative maxFailedAttempts", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });
});

describe("loop config defaults", () => {
  it("loopPauseMs is optional in schema and defaults to 2000", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    // Config without loopPauseMs should validate
    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loopPauseMs).toBe(2000);
    }
  });

  it("loopPauseMs can be customised in config", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), loopPauseMs: 5000 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loopPauseMs).toBe(5000);
    }
  });

  it("rejects negative loopPauseMs", async () => {
    const { validateConfig } = await import("../../../../src/schema/validate.js");
    const { DEFAULT_HENCH_CONFIG } = await import("../../../../src/schema/v1.js");

    const config = { ...DEFAULT_HENCH_CONFIG(), loopPauseMs: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });
});
