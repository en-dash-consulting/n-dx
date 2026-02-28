import { describe, it, expect, vi } from "vitest";
import {
  MemoryThrottle,
  MemoryThrottleRejectError,
  DEFAULT_MEMORY_THROTTLE_CONFIG,
} from "../../../src/process/memory-throttle.js";
import type {
  SystemMemoryReader,
  MemoryThrottleConfig,
} from "../../../src/process/memory-throttle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GB = 1024 * 1024 * 1024;

/** Create a mock memory reader with the given usage percentage. */
function mockReader(usagePercent: number, totalGB = 16): SystemMemoryReader {
  const total = totalGB * GB;
  const free = total * (1 - usagePercent / 100);
  return {
    freemem: () => free,
    totalmem: () => total,
  };
}

/** Create a mock reader that returns different usage on each call. */
function sequentialReader(percentages: number[], totalGB = 16): SystemMemoryReader {
  let callIndex = 0;
  const total = totalGB * GB;
  return {
    freemem: () => {
      const pct = percentages[Math.min(callIndex++, percentages.length - 1)];
      return total * (1 - pct / 100);
    },
    totalmem: () => total,
  };
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe("MemoryThrottle", () => {
  describe("constructor", () => {
    it("creates with default config when no options provided", () => {
      const reader = mockReader(50);
      const throttle = new MemoryThrottle(undefined, reader);
      expect(throttle.config).toEqual(DEFAULT_MEMORY_THROTTLE_CONFIG);
    });

    it("merges partial config with defaults", () => {
      const reader = mockReader(50);
      const throttle = new MemoryThrottle({ delayThreshold: 70 }, reader);
      expect(throttle.config.delayThreshold).toBe(70);
      expect(throttle.config.rejectThreshold).toBe(DEFAULT_MEMORY_THROTTLE_CONFIG.rejectThreshold);
    });

    it("throws RangeError for delayThreshold < 0", () => {
      expect(() => new MemoryThrottle({ delayThreshold: -1 }, mockReader(50)))
        .toThrow(RangeError);
    });

    it("throws RangeError for delayThreshold > 100", () => {
      expect(() => new MemoryThrottle({ delayThreshold: 101 }, mockReader(50)))
        .toThrow(RangeError);
    });

    it("throws RangeError for rejectThreshold < 0", () => {
      expect(() => new MemoryThrottle({ rejectThreshold: -1, delayThreshold: -2 }, mockReader(50)))
        .toThrow(RangeError);
    });

    it("throws RangeError for rejectThreshold > 100", () => {
      expect(() => new MemoryThrottle({ rejectThreshold: 101 }, mockReader(50)))
        .toThrow(RangeError);
    });

    it("throws RangeError when rejectThreshold <= delayThreshold", () => {
      expect(() => new MemoryThrottle({ delayThreshold: 90, rejectThreshold: 90 }, mockReader(50)))
        .toThrow("rejectThreshold must be greater than delayThreshold");
      expect(() => new MemoryThrottle({ delayThreshold: 95, rejectThreshold: 90 }, mockReader(50)))
        .toThrow("rejectThreshold must be greater than delayThreshold");
    });
  });

  // -------------------------------------------------------------------------
  // status()
  // -------------------------------------------------------------------------

  describe("status()", () => {
    it("reports allow when memory usage is below delay threshold", () => {
      const throttle = new MemoryThrottle({ delayThreshold: 80 }, mockReader(50));
      const status = throttle.status();

      expect(status.enabled).toBe(true);
      expect(status.decision).toBe("allow");
      expect(status.memoryUsagePercent).toBeCloseTo(50, 0);
      expect(status.delayThreshold).toBe(80);
      expect(status.rejectThreshold).toBe(DEFAULT_MEMORY_THROTTLE_CONFIG.rejectThreshold);
      expect(status.timestamp).toBeTruthy();
      expect(status.freeMemoryMB).toBeGreaterThan(0);
      expect(status.totalMemoryMB).toBeGreaterThan(0);
    });

    it("reports delay when memory usage is between thresholds", () => {
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95 },
        mockReader(85),
      );
      const status = throttle.status();

      expect(status.decision).toBe("delay");
      expect(status.memoryUsagePercent).toBeCloseTo(85, 0);
    });

    it("reports reject when memory usage exceeds reject threshold", () => {
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95 },
        mockReader(97),
      );
      const status = throttle.status();

      expect(status.decision).toBe("reject");
      expect(status.memoryUsagePercent).toBeCloseTo(97, 0);
    });

    it("reports allow when throttling is disabled", () => {
      const throttle = new MemoryThrottle(
        { enabled: false },
        mockReader(99),
      );
      const status = throttle.status();

      expect(status.enabled).toBe(false);
      expect(status.decision).toBe("allow");
    });

    it("reports at exact delay threshold boundary", () => {
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95 },
        mockReader(80),
      );
      expect(throttle.status().decision).toBe("delay");
    });

    it("reports at exact reject threshold boundary", () => {
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95 },
        mockReader(95),
      );
      expect(throttle.status().decision).toBe("reject");
    });
  });

  // -------------------------------------------------------------------------
  // gate() — allow
  // -------------------------------------------------------------------------

  describe("gate() — allow", () => {
    it("resolves immediately when memory is below threshold", async () => {
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95 },
        mockReader(50),
      );
      const onThrottle = vi.fn();

      await throttle.gate(onThrottle);

      // No callback invoked for immediate allow on first attempt
      expect(onThrottle).not.toHaveBeenCalled();
    });

    it("resolves immediately when throttling is disabled", async () => {
      const throttle = new MemoryThrottle(
        { enabled: false },
        mockReader(99),
      );
      const onThrottle = vi.fn();

      await throttle.gate(onThrottle);
      expect(onThrottle).not.toHaveBeenCalled();
    });

    it("works without a callback", async () => {
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95 },
        mockReader(50),
      );
      // Should not throw
      await throttle.gate();
    });
  });

  // -------------------------------------------------------------------------
  // gate() — reject
  // -------------------------------------------------------------------------

  describe("gate() — reject", () => {
    it("throws MemoryThrottleRejectError when above reject threshold", async () => {
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95 },
        mockReader(97),
      );
      const onThrottle = vi.fn();

      await expect(throttle.gate(onThrottle)).rejects.toThrow(MemoryThrottleRejectError);
      expect(onThrottle).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "reject",
          memoryUsagePercent: expect.closeTo(97, 0),
        }),
      );
    });

    it("reject error contains memory metadata", async () => {
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95 },
        mockReader(97, 16),
      );

      try {
        await throttle.gate();
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(MemoryThrottleRejectError);
        const reject = err as MemoryThrottleRejectError;
        expect(reject.memoryUsagePercent).toBeCloseTo(97, 0);
        expect(reject.rejectThreshold).toBe(95);
        expect(reject.totalMemoryMB).toBeCloseTo(16 * 1024, -1);
        expect(reject.freeMemoryMB).toBeGreaterThan(0);
        expect(reject.message).toContain("exceeds rejection threshold");
        expect(reject.message).toContain("hench config guard.memoryThrottle.rejectThreshold");
      }
    });
  });

  // -------------------------------------------------------------------------
  // gate() — delay with recovery
  // -------------------------------------------------------------------------

  describe("gate() — delay with recovery", () => {
    it("delays then proceeds when memory recovers", async () => {
      // First read: 85% (delay), second read: 70% (allow)
      const reader = sequentialReader([85, 70]);
      const throttle = new MemoryThrottle(
        { delayThreshold: 80, rejectThreshold: 95, baseDelayMs: 10, maxDelayMs: 50 },
        reader,
      );
      const onThrottle = vi.fn();

      await throttle.gate(onThrottle);

      // Called once for delay, once for recovery
      expect(onThrottle).toHaveBeenCalledTimes(2);
      expect(onThrottle).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "delay",
          delayMs: 10,
          attempt: 0,
        }),
      );
      expect(onThrottle).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "allow",
          attempt: 1,
        }),
      );
    });

    it("applies exponential backoff on successive delays", async () => {
      // Three delay reads then allow
      const reader = sequentialReader([85, 87, 89, 70]);
      const throttle = new MemoryThrottle(
        {
          delayThreshold: 80,
          rejectThreshold: 95,
          baseDelayMs: 10,
          maxDelayMs: 1000,
          maxRetries: 5,
        },
        reader,
      );
      const delays: number[] = [];
      const onThrottle = vi.fn(({ delayMs }: { delayMs?: number }) => {
        if (delayMs != null) delays.push(delayMs);
      });

      await throttle.gate(onThrottle);

      // 10, 20, 40 (exponential backoff: base * 2^attempt)
      expect(delays).toEqual([10, 20, 40]);
    });

    it("caps delay at maxDelayMs", async () => {
      // Many delays to test cap
      const reader = sequentialReader([85, 85, 85, 85, 85, 85, 70]);
      const throttle = new MemoryThrottle(
        {
          delayThreshold: 80,
          rejectThreshold: 95,
          baseDelayMs: 10,
          maxDelayMs: 50,
          maxRetries: 10,
        },
        reader,
      );
      const delays: number[] = [];
      const onThrottle = vi.fn(({ delayMs }: { delayMs?: number }) => {
        if (delayMs != null) delays.push(delayMs);
      });

      await throttle.gate(onThrottle);

      // All delays should be <= 50
      for (const d of delays) {
        expect(d).toBeLessThanOrEqual(50);
      }
      // Should have at least one delay at the cap
      expect(delays.some((d) => d === 50)).toBe(true);
    });

    it("rejects after exhausting max retries while in delay zone", async () => {
      // Never recovers
      const reader = mockReader(85); // Always 85%
      const throttle = new MemoryThrottle(
        {
          delayThreshold: 80,
          rejectThreshold: 95,
          baseDelayMs: 1,
          maxDelayMs: 5,
          maxRetries: 3,
        },
        reader,
      );

      await expect(throttle.gate()).rejects.toThrow(MemoryThrottleRejectError);
    });
  });

  // -------------------------------------------------------------------------
  // gate() — delay escalating to reject
  // -------------------------------------------------------------------------

  describe("gate() — delay escalating to reject", () => {
    it("rejects if memory rises above reject threshold during delay", async () => {
      // First read: delay zone, second read: reject zone
      const reader = sequentialReader([85, 97]);
      const throttle = new MemoryThrottle(
        {
          delayThreshold: 80,
          rejectThreshold: 95,
          baseDelayMs: 1,
          maxDelayMs: 5,
          maxRetries: 5,
        },
        reader,
      );
      const onThrottle = vi.fn();

      await expect(throttle.gate(onThrottle)).rejects.toThrow(MemoryThrottleRejectError);

      // First call: delay, second call: reject
      expect(onThrottle).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "delay" }),
      );
      expect(onThrottle).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "reject" }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// MemoryThrottleRejectError
// ---------------------------------------------------------------------------

describe("MemoryThrottleRejectError", () => {
  it("has descriptive message with memory details", () => {
    const err = new MemoryThrottleRejectError(97.5, 95, 400, 16384);
    expect(err.message).toContain("97.5%");
    expect(err.message).toContain("95%");
    expect(err.message).toContain("400");
    expect(err.message).toContain("16384");
    expect(err.message).toContain("hench config guard.memoryThrottle.rejectThreshold");
    expect(err.name).toBe("MemoryThrottleRejectError");
  });

  it("exposes metadata properties", () => {
    const err = new MemoryThrottleRejectError(97.5, 95, 400, 16384);
    expect(err.memoryUsagePercent).toBe(97.5);
    expect(err.rejectThreshold).toBe(95);
    expect(err.freeMemoryMB).toBe(400);
    expect(err.totalMemoryMB).toBe(16384);
  });

  it("is an instance of Error", () => {
    const err = new MemoryThrottleRejectError(97, 95, 400, 16384);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MEMORY_THROTTLE_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_MEMORY_THROTTLE_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_MEMORY_THROTTLE_CONFIG.enabled).toBe(true);
    expect(DEFAULT_MEMORY_THROTTLE_CONFIG.delayThreshold).toBe(80);
    expect(DEFAULT_MEMORY_THROTTLE_CONFIG.rejectThreshold).toBe(95);
    expect(DEFAULT_MEMORY_THROTTLE_CONFIG.baseDelayMs).toBeGreaterThan(0);
    expect(DEFAULT_MEMORY_THROTTLE_CONFIG.maxDelayMs).toBeGreaterThan(DEFAULT_MEMORY_THROTTLE_CONFIG.baseDelayMs);
    expect(DEFAULT_MEMORY_THROTTLE_CONFIG.maxRetries).toBeGreaterThan(0);
  });

  it("has rejectThreshold > delayThreshold", () => {
    expect(DEFAULT_MEMORY_THROTTLE_CONFIG.rejectThreshold)
      .toBeGreaterThan(DEFAULT_MEMORY_THROTTLE_CONFIG.delayThreshold);
  });
});
