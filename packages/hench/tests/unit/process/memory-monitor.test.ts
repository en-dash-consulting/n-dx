import { describe, it, expect } from "vitest";
import {
  SystemMemoryMonitor,
  DEFAULT_MEMORY_MONITOR_CONFIG,
} from "../../../src/process/memory-monitor.js";
import type {
  MemoryMonitorConfig,
  MemoryMonitorOverrides,
} from "../../../src/process/memory-monitor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GB = 1024 * 1024 * 1024;

/** Create mock overrides with a given usage percentage. */
function mockOverrides(
  usagePercent: number,
  opts?: {
    totalGB?: number;
    platform?: NodeJS.Platform;
    linuxAvailablePercent?: number;
    darwinAvailablePercent?: number;
  },
): MemoryMonitorOverrides {
  const totalGB = opts?.totalGB ?? 16;
  const total = totalGB * GB;
  const free = total * (1 - usagePercent / 100);
  const plat = opts?.platform ?? "darwin";

  return {
    platform: plat,
    freemem: () => free,
    totalmem: () => total,
    readLinuxAvailable: async () => {
      if (plat === "linux" && opts?.linuxAvailablePercent !== undefined) {
        return total * (1 - opts.linuxAvailablePercent / 100);
      }
      return undefined;
    },
    readDarwinAvailable: async () => {
      if (plat === "darwin" && opts?.darwinAvailablePercent !== undefined) {
        return total * (1 - opts.darwinAvailablePercent / 100);
      }
      return undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe("SystemMemoryMonitor", () => {
  describe("constructor", () => {
    it("creates with default config when no options provided", () => {
      const monitor = new SystemMemoryMonitor(undefined, mockOverrides(50));
      expect(monitor.config).toEqual(DEFAULT_MEMORY_MONITOR_CONFIG);
    });

    it("merges partial config with defaults", () => {
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 85 },
        mockOverrides(50),
      );
      expect(monitor.config.spawnThreshold).toBe(85);
      expect(monitor.config.enabled).toBe(true);
    });

    it("throws RangeError for spawnThreshold < 0", () => {
      expect(() => new SystemMemoryMonitor({ spawnThreshold: -1 }, mockOverrides(50)))
        .toThrow(RangeError);
    });

    it("throws RangeError for spawnThreshold > 100", () => {
      expect(() => new SystemMemoryMonitor({ spawnThreshold: 101 }, mockOverrides(50)))
        .toThrow(RangeError);
    });

    it("allows boundary values 0 and 100", () => {
      expect(() => new SystemMemoryMonitor({ spawnThreshold: 0 }, mockOverrides(50)))
        .not.toThrow();
      expect(() => new SystemMemoryMonitor({ spawnThreshold: 100 }, mockOverrides(50)))
        .not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // SystemMemoryReader interface
  // -------------------------------------------------------------------------

  describe("SystemMemoryReader interface", () => {
    it("freemem() returns injected value", () => {
      const overrides = mockOverrides(50, { totalGB: 16 });
      const monitor = new SystemMemoryMonitor(undefined, overrides);
      expect(monitor.freemem()).toBe(overrides.freemem!());
    });

    it("totalmem() returns injected value", () => {
      const overrides = mockOverrides(50, { totalGB: 16 });
      const monitor = new SystemMemoryMonitor(undefined, overrides);
      expect(monitor.totalmem()).toBe(overrides.totalmem!());
    });

    it("can be used as SystemMemoryReader for MemoryThrottle", async () => {
      // Just verify it satisfies the interface structurally
      const monitor = new SystemMemoryMonitor(undefined, mockOverrides(50));
      expect(typeof monitor.freemem).toBe("function");
      expect(typeof monitor.totalmem).toBe("function");
      expect(monitor.freemem()).toBeGreaterThan(0);
      expect(monitor.totalmem()).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // snapshot() — macOS/Windows (non-Linux)
  // -------------------------------------------------------------------------

  describe("snapshot() — non-Linux", () => {
    it("returns correct memory usage on macOS", async () => {
      const monitor = new SystemMemoryMonitor(
        undefined,
        mockOverrides(50, { platform: "darwin" }),
      );
      const snap = await monitor.snapshot();

      expect(snap.platform).toBe("darwin");
      expect(snap.usagePercent).toBeCloseTo(50, 0);
      expect(snap.totalMB).toBeCloseTo(16 * 1024, -1);
      expect(snap.freeMB).toBeGreaterThan(0);
      // On non-Linux, available === free
      expect(snap.availableBytes).toBe(snap.freeBytes);
      expect(snap.timestamp).toBeTruthy();
    });

    it("returns correct memory usage on Windows", async () => {
      const monitor = new SystemMemoryMonitor(
        undefined,
        mockOverrides(75, { platform: "win32" }),
      );
      const snap = await monitor.snapshot();

      expect(snap.platform).toBe("win32");
      expect(snap.usagePercent).toBeCloseTo(75, 0);
      expect(snap.availableBytes).toBe(snap.freeBytes);
    });

    it("handles zero total memory gracefully", async () => {
      const monitor = new SystemMemoryMonitor(undefined, {
        platform: "darwin",
        freemem: () => 0,
        totalmem: () => 0,
        readLinuxAvailable: async () => undefined,
      });
      const snap = await monitor.snapshot();
      expect(snap.usagePercent).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // snapshot() — macOS with vm_stat
  // -------------------------------------------------------------------------

  describe("snapshot() — macOS vm_stat", () => {
    it("uses vm_stat available memory for more accurate readings", async () => {
      // os.freemem() says 85% used (only 15% "free" pages)
      // But vm_stat shows 50% used when counting inactive + purgeable pages
      const monitor = new SystemMemoryMonitor(
        undefined,
        mockOverrides(85, {
          platform: "darwin",
          darwinAvailablePercent: 50,
        }),
      );
      const snap = await monitor.snapshot();

      expect(snap.platform).toBe("darwin");
      // Usage should be based on vm_stat available (50%), not os.freemem (85%)
      expect(snap.usagePercent).toBeCloseTo(50, 0);
      // Available should be higher than free
      expect(snap.availableBytes).toBeGreaterThan(snap.freeBytes);
    });

    it("falls back to os.freemem() when vm_stat is unavailable", async () => {
      const monitor = new SystemMemoryMonitor(undefined, {
        platform: "darwin",
        freemem: () => 4 * GB,
        totalmem: () => 16 * GB,
        readLinuxAvailable: async () => undefined,
        readDarwinAvailable: async () => undefined,
      });
      const snap = await monitor.snapshot();

      expect(snap.availableBytes).toBe(snap.freeBytes);
      expect(snap.usagePercent).toBeCloseTo(75, 0);
    });

    it("prevents false throttle triggers with realistic macOS memory", async () => {
      // Realistic scenario: Mac with 32GB RAM
      // os.freemem() reports 97% used (only 1GB "free" pages)
      // vm_stat shows 60% used (12.8GB of inactive+purgeable pages reclaimable)
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 90 },
        mockOverrides(97, {
          platform: "darwin",
          totalGB: 32,
          darwinAvailablePercent: 60,
        }),
      );
      const check = await monitor.checkBeforeSpawn();

      // Without vm_stat: 97% > 90% threshold → would block (false positive)
      // With vm_stat: 60% < 90% threshold → correctly allows
      expect(check.allowed).toBe(true);
      expect(check.usagePercent).toBeCloseTo(60, 0);
    });
  });

  // -------------------------------------------------------------------------
  // snapshot() — Linux with /proc/meminfo
  // -------------------------------------------------------------------------

  describe("snapshot() — Linux", () => {
    it("uses MemAvailable for more accurate readings", async () => {
      // On Linux: os.freemem() reports 20% free, but /proc/meminfo says 40% available
      // (because buffers/cache are reclaimable)
      const monitor = new SystemMemoryMonitor(
        undefined,
        mockOverrides(80, {
          platform: "linux",
          linuxAvailablePercent: 60, // 60% used = 40% available
        }),
      );
      const snap = await monitor.snapshot();

      expect(snap.platform).toBe("linux");
      // Usage should be based on available (60%), not free (80%)
      expect(snap.usagePercent).toBeCloseTo(60, 0);
      // Available should be higher than free (because cache is reclaimable)
      expect(snap.availableBytes).toBeGreaterThan(snap.freeBytes);
    });

    it("falls back to freemem when /proc/meminfo is unavailable", async () => {
      const monitor = new SystemMemoryMonitor(undefined, {
        platform: "linux",
        freemem: () => 4 * GB,
        totalmem: () => 16 * GB,
        readLinuxAvailable: async () => undefined, // /proc/meminfo unavailable
      });
      const snap = await monitor.snapshot();

      // Falls back: available === free
      expect(snap.availableBytes).toBe(snap.freeBytes);
      expect(snap.usagePercent).toBeCloseTo(75, 0);
    });
  });

  // -------------------------------------------------------------------------
  // checkBeforeSpawn() — allowed
  // -------------------------------------------------------------------------

  describe("checkBeforeSpawn() — allowed", () => {
    it("allows when memory is below threshold", async () => {
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 90 },
        mockOverrides(50),
      );
      const check = await monitor.checkBeforeSpawn();

      expect(check.allowed).toBe(true);
      expect(check.usagePercent).toBeCloseTo(50, 0);
      expect(check.spawnThreshold).toBe(90);
      expect(check.reason).toBeUndefined();
    });

    it("allows when monitoring is disabled even if memory is high", async () => {
      const monitor = new SystemMemoryMonitor(
        { enabled: false, spawnThreshold: 50 },
        mockOverrides(99),
      );
      const check = await monitor.checkBeforeSpawn();

      expect(check.allowed).toBe(true);
      expect(check.usagePercent).toBeCloseTo(99, 0);
      expect(check.reason).toBeUndefined();
    });

    it("allows at exactly one below threshold", async () => {
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 90 },
        mockOverrides(89.99),
      );
      const check = await monitor.checkBeforeSpawn();
      expect(check.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // checkBeforeSpawn() — blocked
  // -------------------------------------------------------------------------

  describe("checkBeforeSpawn() — blocked", () => {
    it("blocks when memory exceeds threshold", async () => {
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 90 },
        mockOverrides(95),
      );
      const check = await monitor.checkBeforeSpawn();

      expect(check.allowed).toBe(false);
      expect(check.usagePercent).toBeCloseTo(95, 0);
      expect(check.reason).toBeTruthy();
      expect(check.reason).toContain("exceeds spawn threshold");
      expect(check.reason).toContain("90%");
    });

    it("blocks at exact threshold boundary", async () => {
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 90 },
        mockOverrides(90),
      );
      const check = await monitor.checkBeforeSpawn();
      // At exact threshold (>=), should block
      expect(check.allowed).toBe(false);
    });

    it("includes actionable guidance in reason", async () => {
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 85 },
        mockOverrides(92),
      );
      const check = await monitor.checkBeforeSpawn();

      expect(check.reason).toContain("hench config guard.memoryMonitor.spawnThreshold");
      expect(check.reason).toContain("Available:");
    });

    it("reports memory details in check result", async () => {
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 80 },
        mockOverrides(90, { totalGB: 32 }),
      );
      const check = await monitor.checkBeforeSpawn();

      expect(check.totalMB).toBeCloseTo(32 * 1024, -1);
      expect(check.availableMB).toBeGreaterThan(0);
      expect(check.spawnThreshold).toBe(80);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-platform: Linux available memory for spawn checks
  // -------------------------------------------------------------------------

  describe("checkBeforeSpawn() — Linux available memory", () => {
    it("uses available memory (not free) for threshold comparison", async () => {
      // os.freemem() says 5% free (95% used) — would block at 90% threshold
      // But /proc/meminfo says 70% used (30% available) — should allow
      const monitor = new SystemMemoryMonitor(
        { spawnThreshold: 90 },
        mockOverrides(95, {
          platform: "linux",
          linuxAvailablePercent: 70,
        }),
      );
      const check = await monitor.checkBeforeSpawn();

      // Should be allowed because available-based usage (70%) is below threshold (90%)
      expect(check.allowed).toBe(true);
      expect(check.usagePercent).toBeCloseTo(70, 0);
    });
  });

  // -------------------------------------------------------------------------
  // detectedPlatform
  // -------------------------------------------------------------------------

  describe("detectedPlatform", () => {
    it("returns the injected platform", () => {
      const monitor = new SystemMemoryMonitor(
        undefined,
        mockOverrides(50, { platform: "linux" }),
      );
      expect(monitor.detectedPlatform).toBe("linux");
    });
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MEMORY_MONITOR_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_MEMORY_MONITOR_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_MEMORY_MONITOR_CONFIG.enabled).toBe(true);
    expect(DEFAULT_MEMORY_MONITOR_CONFIG.spawnThreshold).toBe(90);
    expect(DEFAULT_MEMORY_MONITOR_CONFIG.spawnThreshold).toBeGreaterThan(0);
    expect(DEFAULT_MEMORY_MONITOR_CONFIG.spawnThreshold).toBeLessThanOrEqual(100);
  });
});
