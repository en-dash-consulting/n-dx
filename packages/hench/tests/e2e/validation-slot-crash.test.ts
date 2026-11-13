/**
 * A holder that dies while its validation command still runs must not free
 * the host slot: the record names the command's child (its process group on
 * POSIX), and the slot stays held until that child exits too. On Windows the
 * child is not detached, so it ends with its holder and the slot frees then.
 *
 * The holder is a separate Node process running the built hench modules, so
 * it can be SIGKILLed alone, the way an OOM kill takes it. Uses a temp slot
 * directory, never the real ndx home.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquireValidationSlot,
  readValidationSlotHolder,
  type ValidationSlotChild,
  type ValidationSlotWait,
} from "../../src/process/validation-slot.js";

const DIST = join(import.meta.dirname, "../../dist/process");

/** Runs one managed validation whose child never exits, and stays alive itself. */
const HOLDER = `
const { runInValidationSlot } = await import(process.env.RUN_URL);
const { exec } = await import(process.env.EXEC_URL);
await runInValidationSlot(
  { slotDir: process.env.SLOT_DIR, projectDir: "/crashed", pollIntervalMs: 20 },
  (withSlot) => exec(process.execPath, ["-e", "setInterval(() => {}, 1000)"],
    withSlot({ cwd: process.cwd(), timeout: 120000, env: process.env })),
);
`;

let root: string;
let slotDir: string;
let holder: ChildProcess | undefined;
let validationChild: ValidationSlotChild | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-slot-crash-"));
  slotDir = join(root, "validation-slot");
});

afterEach(async () => {
  if (holder && holder.exitCode === null && holder.signalCode === null) holder.kill("SIGKILL");
  if (validationChild) stopChild(validationChild);
  holder = undefined;
  validationChild = undefined;
  await rm(root, { recursive: true, force: true });
});

function stopChild(child: ValidationSlotChild): void {
  try {
    process.kill(child.group && process.platform !== "win32" ? -child.pid : child.pid, "SIGKILL");
  } catch (err) {
    // ESRCH: already gone, which is what the caller wants.
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The child the holder records, or a rejection when the holder exits first. */
async function recordedChild(proc: ChildProcess, stderr: () => string): Promise<ValidationSlotChild> {
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`holder exited (${proc.exitCode}): ${stderr()}`);
    const child = (await readValidationSlotHolder(slotDir))?.child;
    if (child) return child;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("validation slot after its holder is killed", () => {
  it("stays held while the validation child runs, and frees once it exits (on Windows, it dies with the holder)", async () => {
    let stderr = "";
    holder = spawn(process.execPath, ["--input-type=module", "-e", HOLDER], {
      env: {
        ...process.env,
        RUN_URL: pathToFileURL(join(DIST, "validation-run.js")).href,
        EXEC_URL: pathToFileURL(join(DIST, "exec.js")).href,
        SLOT_DIR: slotDir,
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    holder.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const holderPid = holder.pid!;

    const recorded = await recordedChild(holder, () => stderr);
    validationChild = recorded;
    expect(recorded.group).toBe(process.platform !== "win32");

    const holderExited = new Promise((resolve) => holder!.once("exit", resolve));
    holder.kill("SIGKILL");
    await holderExited;

    if (process.platform === "win32") {
      // libuv puts a non-detached child in a kill-on-close job object its
      // parent owns, so killing the holder ends the child too: the record is
      // stale and the next acquire reclaims it.
      const lease = await acquireValidationSlot({ slotDir, projectDir: "/second", env: {}, pollIntervalMs: 20 });
      expect(isAlive(recorded.pid)).toBe(false);
      expect(await readValidationSlotHolder(slotDir)).toMatchObject({ projectDir: "/second", child: null });
      await lease.release();
      return;
    }

    // Counted polls, not elapsed time: five consecutive looks at the record
    // that each found it still occupying the slot.
    const waits: ValidationSlotWait[] = [];
    let fivePolls!: () => void;
    const polledFiveTimes = new Promise<void>((resolve) => (fivePolls = resolve));
    let acquired = false;
    const second = acquireValidationSlot({
      slotDir, projectDir: "/second", env: {}, pollIntervalMs: 20, reportIntervalMs: 0,
      onWait: (wait) => {
        if (waits.push(wait) === 5) fivePolls();
      },
    }).then((lease) => {
      acquired = true;
      return lease;
    });

    // Waits on the dead holder, because its child still runs.
    await Promise.race([polledFiveTimes, second]);
    expect(acquired).toBe(false);
    expect(waits[0]).toMatchObject({ holderAlive: false, holder: { pid: holderPid, child: recorded } });

    stopChild(recorded);
    const lease = await second;
    expect(acquired).toBe(true);
    expect(await readValidationSlotHolder(slotDir)).toMatchObject({ projectDir: "/second", child: null });
    await lease.release();
  });
});
