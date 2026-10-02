import { describe, it, expect, vi } from "vitest";
import {
  createAvailableMemoryReader,
  derivePressure,
  getAvailableMemory,
  parseDarwinPressureLevel,
  parseVmStatAvailableBytes,
  MEMORY_READING_TTL_MS,
  type ExecRunner,
} from "../../src/system-memory.js";

const GB = 1024 ** 3;
const PAGE = 16384;

/** Recorded from a healthy 16 GB Apple-silicon Mac (page size 16384). */
const VM_STAT_16GB = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               19259.
Pages active:                            330218.
Pages inactive:                          225312.
Pages speculative:                         1000.
Pages throttled:                              0.
Pages wired down:                        110552.
Pages purgeable:                            500.
"Translation faults":                 982437211.
`;
const EXPECTED_16GB = (19259 + 225312 + 1000 + 500) * PAGE;

function execStub(outputs: { vm_stat?: string | Error; sysctl?: string | Error }): ExecRunner & ReturnType<typeof vi.fn> {
  return vi.fn(async (command: string) => {
    const out = outputs[command as "vm_stat" | "sysctl"];
    if (out === undefined) throw new Error(`unexpected command ${command}`);
    if (out instanceof Error) throw out;
    return out;
  });
}

function darwin(exec: ExecRunner, extra: { now?: () => number } = {}) {
  return createAvailableMemoryReader({
    platform: "darwin",
    exec,
    totalmem: () => 16 * GB,
    freemem: () => 115 * 1024 * 1024,
    ...extra,
  });
}

describe("parseVmStatAvailableBytes", () => {
  it("sums free + inactive + speculative + purgeable pages × page size", () => {
    const bytes = parseVmStatAvailableBytes(VM_STAT_16GB);
    expect(bytes).toBe(EXPECTED_16GB);
    expect(Math.abs((bytes as number) - 4.0e9) / 4.0e9).toBeLessThan(0.01);
  });

  it("returns null without the page-size header", () => {
    expect(parseVmStatAvailableBytes("Pages free: 100.\nPages inactive: 5.\n")).toBeNull();
  });

  it("returns null without a Pages free line", () => {
    expect(parseVmStatAvailableBytes("Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages inactive: 5.\n")).toBeNull();
  });

  it("returns null (not 0) for garbage and empty output", () => {
    expect(parseVmStatAvailableBytes("")).toBeNull();
    expect(parseVmStatAvailableBytes("command not found")).toBeNull();
  });
});

describe("parseDarwinPressureLevel", () => {
  it.each([["1\n", "normal"], ["2", "warn"], ["4\n", "critical"]])("maps %j to %s", (raw, expected) => {
    expect(parseDarwinPressureLevel(raw)).toBe(expected);
  });

  it.each([[""], ["3"], ["abc"]])("rejects %j", (raw) => {
    expect(parseDarwinPressureLevel(raw)).toBeNull();
  });
});

describe("derivePressure", () => {
  it("uses 75% / 90% used thresholds", () => {
    expect(derivePressure(26, 100)).toBe("normal"); // 74% used
    expect(derivePressure(25, 100)).toBe("warn"); // 75% used
    expect(derivePressure(11, 100)).toBe("warn"); // 89% used
    expect(derivePressure(10, 100)).toBe("critical"); // 90% used
  });
});

describe("darwin reader", () => {
  it("reads reclaimable bytes and kernel pressure", async () => {
    const reading = await darwin(execStub({ vm_stat: VM_STAT_16GB, sysctl: "1\n" })).read();
    expect(reading.availableBytes).toBe(EXPECTED_16GB);
    expect(reading.totalBytes).toBe(16 * GB);
    expect(reading.pressure).toBe("normal");
    expect(reading.source).toContain("vm_stat");
  });

  it.each([["2", "warn"], ["4", "critical"]])("sysctl %s → %s", async (level, expected) => {
    const reading = await darwin(execStub({ vm_stat: VM_STAT_16GB, sysctl: level })).read();
    expect(reading.pressure).toBe(expected);
  });

  it.each(["ENOENT", "EPERM", "ETIMEDOUT"])("both commands failing (%s) is null/unknown and does not throw", async (code) => {
    const err = Object.assign(new Error(code), { code });
    const reading = await darwin(execStub({ vm_stat: err, sysctl: err })).read();
    expect(reading.availableBytes).toBeNull();
    expect(reading.pressure).toBe("unknown");
  });

  it("unparseable vm_stat is null — never 0 and never os.freemem()", async () => {
    const reading = await darwin(execStub({ vm_stat: "garbage", sysctl: "1" })).read();
    expect(reading.availableBytes).toBeNull();
    expect(reading.pressure).toBe("normal");
  });

  it("derives pressure from available% when only sysctl fails", async () => {
    const err = new Error("EPERM");
    const reading = await darwin(execStub({ vm_stat: VM_STAT_16GB, sysctl: err })).read();
    expect(reading.availableBytes).toBe(EXPECTED_16GB);
    expect(reading.pressure).toBe(derivePressure(EXPECTED_16GB, 16 * GB));
  });

  it("keeps the kernel pressure when only vm_stat fails", async () => {
    const reading = await darwin(execStub({ vm_stat: new Error("ENOENT"), sysctl: "4" })).read();
    expect(reading.availableBytes).toBeNull();
    expect(reading.pressure).toBe("critical");
  });
});

describe("caching", () => {
  it("runs the commands once for reads within the TTL, again after it", async () => {
    let t = 1_000;
    const exec = execStub({ vm_stat: VM_STAT_16GB, sysctl: "1" });
    const reader = darwin(exec, { now: () => t });
    await reader.read();
    t += MEMORY_READING_TTL_MS - 1;
    await reader.read();
    expect(exec).toHaveBeenCalledTimes(2); // vm_stat + sysctl, once
    t += 2;
    await reader.read();
    expect(exec).toHaveBeenCalledTimes(4);
  });

  it("concurrent refreshes share one spawn", async () => {
    const exec = execStub({ vm_stat: VM_STAT_16GB, sysctl: "1" });
    const reader = darwin(exec);
    const [a, b] = await Promise.all([reader.read(), reader.read()]);
    expect(a).toEqual(b);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("get() is synchronous: pending before the first reading, cached after", async () => {
    const exec = execStub({ vm_stat: VM_STAT_16GB, sysctl: "1" });
    const reader = darwin(exec);
    const pending = reader.get();
    expect(pending).toEqual({ availableBytes: null, totalBytes: 16 * GB, pressure: "unknown", source: "pending" });
    await reader.read();
    expect(reader.get().availableBytes).toBe(EXPECTED_16GB);
    expect(exec).toHaveBeenCalledTimes(2); // get() reused the in-flight refresh
  });
});

describe.each(["linux", "win32"] as const)("%s reader", (platform) => {
  const make = (free: number) => {
    const exec = vi.fn();
    const reader = createAvailableMemoryReader({ platform, exec, freemem: () => free, totalmem: () => 100 });
    return { exec, reader };
  };

  it("uses os.freemem() exactly and never spawns", async () => {
    const { exec, reader } = make(12_345);
    expect((await reader.read()).availableBytes).toBe(12_345);
    expect(reader.get().availableBytes).toBe(12_345);
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([[26, "normal"], [25, "warn"], [10, "critical"]] as const)("free %i of 100 → %s", async (free, pressure) => {
    expect((await make(free).reader.read()).pressure).toBe(pressure);
  });
});

describe("default reader", () => {
  it("get() returns a reading synchronously", () => {
    const reading = getAvailableMemory();
    expect(reading.totalBytes).toBeGreaterThan(0);
  });
});
