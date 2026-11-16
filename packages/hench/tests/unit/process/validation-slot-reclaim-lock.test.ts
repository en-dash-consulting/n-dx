/**
 * The reclaim lock's owner check (validation-slot.ts rule 5). Kept apart from
 * validation-slot.test.ts because it wraps `node:fs/promises` to replace the
 * lock at the one moment that matters: while this process holds it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireValidationSlot,
  currentBootTimeMs,
  VALIDATION_SLOT_HOLDER_FILE,
  VALIDATION_SLOT_RECLAIM_FILE,
} from "../../../src/process/validation-slot.js";

/** A pid no process holds (above any OS's pid range); a freed pid can be reused on Windows. */
const DEAD_PID = 2 ** 30;

/** Bounds an acquire that must not wait, so a regression fails instead of hanging the suite. */
function bounded(): AbortSignal {
  return AbortSignal.timeout(10_000);
}

/** Runs just before the module under test unlinks a path; null when idle. */
let beforeUnlink: ((path: string) => Promise<void>) | null = null;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      if (beforeUnlink) await beforeUnlink(String(path));
      return actual.unlink(path);
    },
  };
});

let slotDir: string;

beforeEach(async () => {
  slotDir = await fsp.mkdtemp(join(tmpdir(), "hench-validation-slot-reclaim-"));
});

afterEach(async () => {
  beforeUnlink = null;
  await fsp.rm(slotDir, { recursive: true, force: true });
});

describe("acquireValidationSlot — reclaim lock ownership", () => {
  it("leaves a reclaim.lock that replaced its own before it finished", async () => {
    await fsp.writeFile(
      join(slotDir, VALIDATION_SLOT_HOLDER_FILE),
      JSON.stringify({
        version: 1, token: "stale-token", pid: DEAD_PID, child: null,
        startedAt: "2026-11-12T00:00:00.000Z", bootedAt: currentBootTimeMs(), projectDir: "/elsewhere",
      }),
      "utf-8",
    );
    const lockPath = join(slotDir, VALIDATION_SLOT_RECLAIM_FILE);
    const theirs = JSON.stringify({ pid: process.ppid, token: "other-waiter", startedAt: "2026-11-14T00:00:00.000Z" });
    let ours: string | null = null;

    // While this process removes the stale holder under its lock, another
    // waiter judges that lock stale and writes its own in its place.
    beforeUnlink = async (path) => {
      if (!path.endsWith(VALIDATION_SLOT_HOLDER_FILE)) return;
      beforeUnlink = null;
      ours = await fsp.readFile(lockPath, "utf-8");
      await fsp.writeFile(lockPath, theirs, "utf-8");
    };

    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {}, signal: bounded() });
    await lease.release();

    expect(JSON.parse(ours!)).toMatchObject({ pid: process.pid });
    expect(await fsp.readFile(lockPath, "utf-8")).toBe(theirs);
  });

  it("still removes its own reclaim.lock", async () => {
    await fsp.writeFile(
      join(slotDir, VALIDATION_SLOT_HOLDER_FILE),
      JSON.stringify({
        version: 1, token: "stale-token", pid: DEAD_PID, child: null,
        startedAt: "2026-11-12T00:00:00.000Z", bootedAt: currentBootTimeMs(), projectDir: "/elsewhere",
      }),
      "utf-8",
    );
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/proj", env: {}, signal: bounded() });
    await lease.release();
    await expect(fsp.access(join(slotDir, VALIDATION_SLOT_RECLAIM_FILE))).rejects.toThrow();
  });
});
