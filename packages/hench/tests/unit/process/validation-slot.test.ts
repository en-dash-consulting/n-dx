import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  acquireValidationSlot,
  currentBootTimeMs,
  readValidationSlotHolder,
  ValidationSlotAbortedError,
  VALIDATION_SLOT_ENV,
  VALIDATION_SLOT_HOLDER_FILE,
  VALIDATION_SLOT_DIRNAME,
  type ValidationSlotHolder,
  type ValidationSlotWait,
} from "../../../src/process/validation-slot.js";
import { resolveValidationSlotDir } from "../../../src/process/validation-slot-dir.js";

const MODULE_URL = pathToFileURL(
  fileURLToPath(new URL("../../../src/process/validation-slot.ts", import.meta.url)),
).href;

let root: string;
let slotDir: string;
const spawned: ChildProcess[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-validation-slot-"));
  slotDir = join(root, VALIDATION_SLOT_DIRNAME);
});

afterEach(async () => {
  for (const child of spawned.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await rm(root, { recursive: true, force: true });
});

/** A pid that existed and has exited. */
function deadPid(): number {
  const result = spawnSync(process.execPath, ["-e", "0"], { windowsHide: true });
  return result.pid;
}

/** A child that runs until killed; its own process group on POSIX. */
function liveChild(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  spawned.push(child);
  return child;
}

async function writeHolder(record: Partial<ValidationSlotHolder>): Promise<string> {
  const full: ValidationSlotHolder = {
    version: 1,
    token: "stale-token",
    pid: deadPid(),
    child: null,
    startedAt: "2026-11-12T00:00:00.000Z",
    bootedAt: currentBootTimeMs(),
    projectDir: "/elsewhere",
    ...record,
  };
  const raw = JSON.stringify(full);
  await mkdir(slotDir, { recursive: true });
  await writeFile(join(slotDir, VALIDATION_SLOT_HOLDER_FILE), raw, "utf-8");
  return raw;
}

async function holderRaw(): Promise<string | null> {
  try {
    return await readFile(join(slotDir, VALIDATION_SLOT_HOLDER_FILE), "utf-8");
  } catch {
    return null;
  }
}

/** Wait until the slot is reported busy, then abort; resolves to what was reported. */
async function waitThenAbort(): Promise<{ waits: ValidationSlotWait[]; error: unknown }> {
  const controller = new AbortController();
  const waits: ValidationSlotWait[] = [];
  const error = await acquireValidationSlot({
    slotDir,
    projectDir: "/here",
    env: {},
    signal: controller.signal,
    pollIntervalMs: 10,
    onWait: (wait) => {
      waits.push(wait);
      controller.abort();
    },
  }).then(
    () => undefined,
    (err: unknown) => err,
  );
  return { waits, error };
}

describe("acquireValidationSlot — holding and releasing", () => {
  it("writes a holder record naming pid, project, start time and token, and release removes it", async () => {
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {}, now: () => 5 });
    expect(lease.nested).toBe(false);
    expect(lease.queueWaitMs).toBe(0);

    const holder = await readValidationSlotHolder(slotDir);
    expect(holder).toMatchObject({ version: 1, pid: process.pid, projectDir: "/proj", token: lease.token, child: null });
    expect(Number.isNaN(Date.parse(holder!.startedAt))).toBe(false);

    await lease.release();
    expect(await holderRaw()).toBeNull();
    await lease.release(); // idempotent
  });

  it("records the launched child, as a pid or a process group", async () => {
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {} });
    await lease.recordChild(4242, { group: true });
    expect((await readValidationSlotHolder(slotDir))?.child).toEqual({ pid: 4242, group: true });
    await lease.recordChild(4343);
    expect((await readValidationSlotHolder(slotDir))?.child).toEqual({ pid: 4343, group: false });
    await lease.release();
  });

  it("release removes only the holder's own record", async () => {
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {} });
    const other = await writeHolder({ token: "someone-else", pid: process.pid });
    await lease.release();
    expect(await holderRaw()).toBe(other);
  });

  it("childEnv exports the token as NDX_VALIDATION_SLOT", async () => {
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {} });
    expect(lease.childEnv({ PATH: "/bin" })).toEqual({ PATH: "/bin", [VALIDATION_SLOT_ENV]: lease.token });
    await lease.release();
  });
});

describe("acquireValidationSlot — contention in one process", () => {
  it("waits while held, reports the holder, then acquires after release with the queue wait", async () => {
    const first = await acquireValidationSlot({ slotDir, projectDir: "/first", env: {} });
    let clock = 1_000;
    const waits: ValidationSlotWait[] = [];
    const second = await acquireValidationSlot({
      slotDir,
      projectDir: "/second",
      env: {},
      pollIntervalMs: 10,
      now: () => clock,
      onWait: (wait) => {
        waits.push(wait);
        // Still the first holder's record while the second waits.
        clock = 1_750;
        void first.release();
      },
    });

    expect(waits).toHaveLength(1);
    expect(waits[0].holder).toMatchObject({ pid: process.pid, projectDir: "/first", token: first.token });
    expect(waits[0].holderAlive).toBe(true);
    expect(second.token).not.toBe(first.token);
    expect(second.queueWaitMs).toBe(750);
    expect((await readValidationSlotHolder(slotDir))?.token).toBe(second.token);
    await second.release();
  });

  it("reports once at first and again only after the report interval", async () => {
    const first = await acquireValidationSlot({ slotDir, projectDir: "/first", env: {} });
    let clock = 0;
    const reported: number[] = [];
    let clockReads = 0;
    const second = await acquireValidationSlot({
      slotDir,
      projectDir: "/second",
      env: {},
      pollIntervalMs: 10,
      reportIntervalMs: 500,
      // Each clock read advances 100 ms, so reports must skip polls.
      now: () => {
        clockReads++;
        return (clock += 100);
      },
      onWait: (wait) => {
        reported.push(wait.waitedMs);
        if (reported.length === 3) void first.release();
      },
    });

    expect(reported).toHaveLength(3);
    for (let i = 1; i < reported.length; i++) {
      expect(reported[i] - reported[i - 1]).toBeGreaterThanOrEqual(500);
    }
    // More polls happened than reports: the interval, not the poll, paces them.
    expect(clockReads).toBeGreaterThan(reported.length * 2);
    await second.release();
  });
});

describe("acquireValidationSlot — stale recovery", () => {
  it("reclaims a record whose holder is dead and has no child", async () => {
    await writeHolder({});
    const waits: ValidationSlotWait[] = [];
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {}, onWait: (w) => waits.push(w) });
    expect(waits).toEqual([]);
    expect((await readValidationSlotHolder(slotDir))?.token).toBe(lease.token);
    await lease.release();
  });

  it("reclaims a record whose holder and recorded child are both dead", async () => {
    await writeHolder({ child: { pid: deadPid(), group: false } });
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {}, onWait: () => {
      throw new Error("should not wait");
    } });
    expect((await readValidationSlotHolder(slotDir))?.token).toBe(lease.token);
    await lease.release();
  });

  it("reclaims a record written before a reboot, even when its pids are now in use", async () => {
    // After a crash and reboot the old pid can belong to an unrelated live
    // process; the record must not hold the slot forever.
    const live = liveChild();
    await writeHolder({
      pid: process.pid,
      child: { pid: live.pid!, group: false },
      bootedAt: currentBootTimeMs() - 24 * 60 * 60_000,
    });
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {}, onWait: () => {
      throw new Error("a record from a previous boot must not be waited on");
    } });
    expect((await readValidationSlotHolder(slotDir))?.token).toBe(lease.token);
    await lease.release();
  });

  it("records this boot's time in the holder record", async () => {
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {} });
    const holder = await readValidationSlotHolder(slotDir);
    // Two readings of one boot agree to well within the five-minute tolerance.
    expect(Math.abs(holder!.bootedAt - currentBootTimeMs())).toBeLessThan(60_000);
    await lease.release();
  });

  it("reclaims a record that does not parse", async () => {
    await mkdir(slotDir, { recursive: true });
    await writeFile(join(slotDir, VALIDATION_SLOT_HOLDER_FILE), "{not json", "utf-8");
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {} });
    expect((await readValidationSlotHolder(slotDir))?.token).toBe(lease.token);
    await lease.release();
  });

  it("does not reclaim a record whose holder is dead but whose test child is alive", async () => {
    const child = liveChild();
    const raw = await writeHolder({ child: { pid: child.pid!, group: false } });
    const { waits, error } = await waitThenAbort();
    expect(error).toBeInstanceOf(ValidationSlotAbortedError);
    expect(waits).toHaveLength(1);
    expect(waits[0].holderAlive).toBe(false);
    expect(await holderRaw()).toBe(raw);
  });

  it.skipIf(process.platform === "win32")("does not reclaim while a recorded process group is alive", async () => {
    const child = liveChild();
    const raw = await writeHolder({ child: { pid: child.pid!, group: true } });
    const { error } = await waitThenAbort();
    expect(error).toBeInstanceOf(ValidationSlotAbortedError);
    expect(await holderRaw()).toBe(raw);
  });
});

describe("acquireValidationSlot — nesting", () => {
  it("a token for the live holder of this slot returns nested without taking or releasing", async () => {
    const outer = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {} });
    const before = await holderRaw();
    const inner = await acquireValidationSlot({
      slotDir,
      projectDir: "/proj",
      env: outer.childEnv({}),
      onWait: () => {
        throw new Error("a nested acquire must not wait");
      },
    });
    expect(inner).toMatchObject({ nested: true, token: outer.token, queueWaitMs: 0 });
    await inner.recordChild(4242);
    await inner.release();
    expect(await holderRaw()).toBe(before);
    await outer.release();
    expect(await holderRaw()).toBeNull();
  });

  it("ignores a token whose holder is dead", async () => {
    await writeHolder({ token: "dead-holder" });
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: { [VALIDATION_SLOT_ENV]: "dead-holder" } });
    expect(lease.nested).toBe(false);
    expect(lease.token).not.toBe("dead-holder");
    expect((await readValidationSlotHolder(slotDir))?.token).toBe(lease.token);
    await lease.release();
  });

  it("ignores a token for a different slot directory", async () => {
    const otherDir = join(root, "other-slot");
    const outer = await acquireValidationSlot({ slotDir: otherDir, projectDir: "/proj", env: {} });
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: outer.childEnv({}) });
    expect(lease.nested).toBe(false);
    expect((await readValidationSlotHolder(slotDir))?.token).toBe(lease.token);
    await lease.release();
    await outer.release();
  });
});

describe("acquireValidationSlot — abort", () => {
  it("stops a wait at once on abort, without waiting out the poll interval, and reports the queue wait", async () => {
    const holder = await acquireValidationSlot({ slotDir, projectDir: "/first", env: {} });
    const controller = new AbortController();
    let clock = 0;
    // Timers never fire: only the abort can end the poll's sleep.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let error: unknown;
    try {
      error = await acquireValidationSlot({
        slotDir,
        projectDir: "/second",
        env: {},
        signal: controller.signal,
        pollIntervalMs: 10_000,
        now: () => clock,
        onWait: () => {
          clock = 320;
          controller.abort(new Error("Ctrl-C"));
        },
      }).then(() => undefined, (err: unknown) => err);
    } finally {
      vi.useRealTimers();
    }
    expect(error).toBeInstanceOf(ValidationSlotAbortedError);
    expect((error as ValidationSlotAbortedError).queueWaitMs).toBe(320);
    expect((error as Error).cause).toEqual(new Error("Ctrl-C"));
    expect((await readValidationSlotHolder(slotDir))?.token).toBe(holder.token);
    await holder.release();
  });

  it("an already-aborted signal never takes a held slot", async () => {
    const holder = await acquireValidationSlot({ slotDir, projectDir: "/first", env: {} });
    const error = await acquireValidationSlot({
      slotDir,
      projectDir: "/second",
      env: {},
      signal: AbortSignal.abort(),
    }).then(() => undefined, (err: unknown) => err);
    expect(error).toBeInstanceOf(ValidationSlotAbortedError);
    await holder.release();
  });
});

// ---------------------------------------------------------------------------
// Two real processes
// ---------------------------------------------------------------------------

/**
 * A child that takes the slot, prints `waiting` / `acquired`, and releases
 * when a line arrives on stdin. It loads the module with Node's type
 * stripping, which is why validation-slot.ts imports only node: builtins.
 */
const CONTENDER = `
const { acquireValidationSlot } = await import(process.env.SLOT_MODULE_URL);
const lease = await acquireValidationSlot({
  slotDir: process.env.SLOT_DIR,
  projectDir: process.env.SLOT_PROJECT,
  env: {},
  pollIntervalMs: 20,
  onWait: (w) => console.log("waiting " + w.holder.pid),
});
console.log("acquired " + process.pid);
process.stdin.once("data", async () => {
  await lease.release();
  console.log("released");
  process.exit(0);
});
`;

interface Contender {
  child: ChildProcess;
  lines: string[];
  next(prefix: string): Promise<string>;
}

function startContender(project: string): Contender {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", CONTENDER],
    {
      env: { ...process.env, SLOT_MODULE_URL: MODULE_URL, SLOT_DIR: slotDir, SLOT_PROJECT: project },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  spawned.push(child);
  const lines: string[] = [];
  const waiters: Array<{ prefix: string; resolve: (line: string) => void }> = [];
  let buffer = "";
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      lines.push(line);
      for (const waiter of waiters.splice(0)) {
        if (line.startsWith(waiter.prefix)) waiter.resolve(line);
        else waiters.push(waiter);
      }
    }
  });
  return {
    child,
    lines,
    next: (prefix) =>
      new Promise((resolve, reject) => {
        const seen = lines.find((l) => l.startsWith(prefix));
        if (seen) return resolve(seen);
        waiters.push({ prefix, resolve });
        child.once("exit", (code) => reject(new Error(`contender exited (${code}) before "${prefix}": ${stderr}`)));
      }),
  };
}

const stripTypes = Number(process.versions.node.split(".")[0]) > 22 ||
  Number(process.versions.node.split(".")[1]) >= 6;

describe("acquireValidationSlot — two processes", () => {
  it.skipIf(!stripTypes)("never holds the slot in both; the second waits, then acquires after release", async () => {
    const first = startContender("/first");
    await first.next("acquired");
    expect((await readValidationSlotHolder(slotDir))?.pid).toBe(first.child.pid);

    const second = startContender("/second");
    expect(await second.next("waiting")).toBe(`waiting ${first.child.pid}`);
    // The second is queued, and the slot is still the first's.
    expect(second.lines.some((l) => l.startsWith("acquired"))).toBe(false);
    expect((await readValidationSlotHolder(slotDir))?.pid).toBe(first.child.pid);

    first.child.stdin!.write("release\n");
    await first.next("released");
    expect(await second.next("acquired")).toBe(`acquired ${second.child.pid}`);
    expect((await readValidationSlotHolder(slotDir))).toMatchObject({ pid: second.child.pid, projectDir: "/second" });

    second.child.stdin!.write("release\n");
    await second.next("released");
    await expect(access(join(slotDir, VALIDATION_SLOT_HOLDER_FILE))).rejects.toThrow();
  });
});

describe("resolveValidationSlotDir", () => {
  it("is validation-slot under the ndx home the environment names", () => {
    expect(resolveValidationSlotDir({ NDX_HOME: root })).toBe(join(root, VALIDATION_SLOT_DIRNAME));
  });
});
