/**
 * MemoryThrottle's default reader is the shared llm-client reading, not
 * os.freemem(). os.freemem() is mocked to the 115 MB a healthy 16 GB Mac
 * reports, so any path still reading it would reject at ~99% used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const GB = 1024 * 1024 * 1024;
const TOTAL = 16 * GB;

const shared = vi.hoisted(() => ({
  availableBytes: null as number | null,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, freemem: () => 115 * 1024 * 1024, totalmem: () => 16 * 1024 * 1024 * 1024 };
});

vi.mock("../../../src/prd/llm-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/prd/llm-gateway.js")>();
  const reading = () => ({
    availableBytes: shared.availableBytes,
    totalBytes: 16 * 1024 * 1024 * 1024,
    pressure: shared.availableBytes === null ? "unknown" as const : "normal" as const,
    source: shared.availableBytes === null ? "darwin:unavailable" : "darwin:vm_stat+sysctl",
  });
  return {
    ...actual,
    readAvailableMemory: vi.fn(async () => reading()),
    getAvailableMemory: vi.fn(() => reading()),
  };
});

const { MemoryThrottle } = await import("../../../src/process/memory-throttle.js");

describe("MemoryThrottle — shared available-memory reading", () => {
  beforeEach(() => {
    shared.availableBytes = null;
  });

  it("allows when os.freemem() is 115 MB but the shared reading is 3.9 GB available", async () => {
    shared.availableBytes = 3.9 * GB;
    const throttle = new MemoryThrottle({ enabled: true, delayThreshold: 80, rejectThreshold: 95 });
    const onThrottle = vi.fn();

    await expect(throttle.gate(onThrottle)).resolves.toBeUndefined();
    expect(onThrottle).not.toHaveBeenCalled();

    const status = throttle.status();
    expect(status.decision).toBe("allow");
    expect(status.memoryUsagePercent).toBeCloseTo(((TOTAL - 3.9 * GB) / TOTAL) * 100, 1);
  });

  it("allows an unknown reading without delaying, whatever the thresholds", async () => {
    const throttle = new MemoryThrottle({
      enabled: true,
      delayThreshold: 0,
      rejectThreshold: 1,
      baseDelayMs: 1,
      maxDelayMs: 1,
    });
    const onThrottle = vi.fn();

    await expect(throttle.gate(onThrottle)).resolves.toBeUndefined();
    expect(onThrottle).not.toHaveBeenCalled();

    const status = throttle.status();
    expect(status.decision).toBe("allow");
    expect(status.memoryUsagePercent).toBeNull();
    expect(status.freeMemoryMB).toBeNull();
  });
});
