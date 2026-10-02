import { describe, it, expect } from "vitest";
import {
  SystemMemoryMonitor,
  DEFAULT_MEMORY_MONITOR_CONFIG,
} from "../../../src/process/memory-monitor.js";
import type {
  MemoryMonitorOverrides,
} from "../../../src/process/memory-monitor.js";
import type { AvailableMemoryReading } from "../../../src/prd/llm-gateway.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GB = 1024 * 1024 * 1024;

/** A shared-module reading, as `readAvailableMemory()` returns it. */
function reading(availableBytes: number | null, totalBytes: number): AvailableMemoryReading {
  return {
    availableBytes,
    totalBytes,
    pressure: availableBytes === null ? "unknown" : "normal",
    source: availableBytes === null ? "darwin:unavailable" : "darwin:vm_stat+sysctl",
  };
}

/**
 * Create mock overrides with a given os.freemem() usage percentage.
 *
 * On darwin the shared reading is injected (`readAvailable`) so no real
 * `vm_stat` runs; it reports `darwinAvailablePercent` used, or the same as
 * freemem when that is not given. On linux/win32 the shared module's own
 * os.freemem() path is used, so the platform decision stays in llm-client.
 */
function mockOverrides(
  usagePercent: number,
  opts?: {
    totalGB?: number;
    platform?: NodeJS.Platform;
    darwinAvailablePercent?: number;
  },
): MemoryMonitorOverrides {
  const totalGB = opts?.totalGB ?? 16;
  const total = totalGB * GB;
  const free = total * (1 - usagePercent / 100);
  const plat = opts?.platform ?? "darwin";
  const darwinUsed = opts?.darwinAvailablePercent ?? usagePercent;

  return {
    platform: plat,
    freemem: () => free,
    totalmem: () => total,
    ...(plat === "darwin" && {
      readAvailable: async () => reading(total * (1 - darwinUsed / 100), total),
    }),
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
      // The injected shared reading matches freemem here
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

    it("reads Windows availability straight from os.freemem()", async () => {
      // Pins a measured decision, not an accident. os.freemem() on Windows already
      // reports standby-inclusive availability — measured at -0.08 percentage points
      // against `\Memory\Available MBytes` on a quiet 31.5 GiB box — so no separate
      // reader is warranted. The cost of getting this wrong is specific:
      // checkBeforeSpawn() runs on every process-spawning tool call, so a reader
      // that shells out would add a child process per tool call. If this test starts
      // failing because a Windows reader was added, the module docblock explains what
      // measurement to bring first.
      const monitor = new SystemMemoryMonitor(undefined, {
        platform: "win32",
        totalmem: () => 16 * GB,
        freemem: () => 4 * GB,
      });

      const snap = await monitor.snapshot();

      // Availability comes straight from freemem, so usagePercent follows it.
      expect(snap.availableBytes).toBe(4 * GB);
      expect(snap.usagePercent).toBeCloseTo(75, 0);
    });

    it("handles zero total memory gracefully", async () => {
      const monitor = new SystemMemoryMonitor(undefined, {
        platform: "darwin",
        freemem: () => 0,
        totalmem: () => 0,
        readAvailable: async () => reading(0, 0),
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

    it("reports unknown, never os.freemem(), when vm_stat is unavailable", async () => {
      const monitor = new SystemMemoryMonitor(undefined, {
        platform: "darwin",
        freemem: () => 115 * 1024 * 1024,
        totalmem: () => 16 * GB,
        readAvailable: async () => reading(null, 16 * GB),
      });
      const snap = await monitor.snapshot();

      expect(snap.availableBytes).toBeNull();
      expect(snap.availableMB).toBeNull();
      expect(snap.usagePercent).toBeNull();
      expect(snap.freeBytes).toBe(115 * 1024 * 1024);
    });

    it("allows spawning on an unknown reading even at 99% os.freemem() usage", async () => {
      const monitor = new SystemMemoryMonitor({ spawnThreshold: 1 }, {
        platform: "darwin",
        freemem: () => 115 * 1024 * 1024,
        totalmem: () => 16 * GB,
        readAvailable: async () => reading(null, 16 * GB),
      });
      const check = await monitor.checkBeforeSpawn();

      expect(check.allowed).toBe(true);
      expect(check.reason).toBeUndefined();
      expect(check.usagePercent).toBeNull();
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
  // snapshot() — Linux
  // -------------------------------------------------------------------------

  describe("snapshot() — Linux", () => {
    it("takes availability from os.freemem(), which is MemAvailable on Linux", async () => {
      // libuv ≥ 1.45 returns MemAvailable (cache-inclusive) from os.freemem() on
      // Linux, so the shared reading uses it directly and reads no /proc/meminfo.
      const monitor = new SystemMemoryMonitor(undefined, {
        platform: "linux",
        freemem: () => 4 * GB,
        totalmem: () => 16 * GB,
      });
      const snap = await monitor.snapshot();

      expect(snap.platform).toBe("linux");
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
    it("compares os.freemem() (MemAvailable) against the threshold", async () => {
      const allowed = await new SystemMemoryMonitor(
        { spawnThreshold: 90 },
        mockOverrides(70, { platform: "linux" }),
      ).checkBeforeSpawn();
      expect(allowed.allowed).toBe(true);
      expect(allowed.usagePercent).toBeCloseTo(70, 0);

      const blocked = await new SystemMemoryMonitor(
        { spawnThreshold: 90 },
        mockOverrides(95, { platform: "linux" }),
      ).checkBeforeSpawn();
      expect(blocked.allowed).toBe(false);
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
