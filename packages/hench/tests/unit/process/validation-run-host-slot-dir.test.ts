import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reclaimHostValidationSlot,
  runInValidationSlot,
  withHostValidationSlotDir,
} from "../../../src/process/validation-run.js";
import {
  acquireValidationSlot,
  currentBootTimeMs,
  VALIDATION_SLOT_DIR_ENV,
  VALIDATION_SLOT_DIRNAME,
  VALIDATION_SLOT_ENV,
  VALIDATION_SLOT_HOLDER_FILE,
  type ValidationSlotLease,
} from "../../../src/process/validation-slot.js";
import {
  createHostIdentityCache,
  HostIdentityLookupError,
  validationSlotHostDirname,
  type HostIdentity,
  type HostIdentitySources,
  type LookupRun,
} from "../../../src/process/validation-slot-dir.js";

// Every production lookup fails, as `ioreg` refused by a sandbox or timing out
// on a loaded host would: a run that needs the lookup cannot get a directory.
const { lookups } = vi.hoisted(() => ({ lookups: { count: 0 } }));
vi.mock("../../../src/process/validation-slot-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/process/validation-slot-dir.js")>();
  const failing = async (): Promise<HostIdentity> => {
    lookups.count++;
    throw new actual.HostIdentityLookupError("running ioreg -rd1 -c IOPlatformExpertDevice", "exited with code 1");
  };
  return {
    ...actual,
    resolveValidationSlotDir: (env?: NodeJS.ProcessEnv) => actual.resolveValidationSlotDir(env, failing),
  };
});

const LINUX_ID = "0123456789abcdef0123456789abcdef";
const IDENTITY: HostIdentity = { kind: "machine", id: LINUX_ID };
/** A pid no process holds (above any OS's pid range). */
const DEAD_PID = 2 ** 30;

/** Darwin sources whose `ioreg` answers through `answer`, counting runs. */
function ioregSources(answer: () => Promise<LookupRun>): HostIdentitySources & { runs: number } {
  const src = {
    platform: "darwin" as const,
    readFile: async (path: string): Promise<string> => {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    },
    run: async (): Promise<LookupRun> => {
      src.runs++;
      return answer();
    },
    hostname: () => "host.local",
    runs: 0,
  };
  return src;
}

const settlesWithin = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
};

let home: string;
let held: ValidationSlotLease | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "hench-host-slot-dir-"));
  lookups.count = 0;
});

afterEach(async () => {
  await held?.release();
  held = undefined;
  await rm(home, { recursive: true, force: true });
});

describe("runInValidationSlot with a slot directory handed down", () => {
  it("nests on the holder NDX_VALIDATION_SLOT and NDX_VALIDATION_SLOT_DIR name, without the failing lookup", async () => {
    const slotDir = join(home, "holder-slot");
    held = await acquireValidationSlot({ slotDir, projectDir: "/holder", env: {} });
    const run = await runInValidationSlot(
      { projectDir: home, env: held.childEnv({}) },
      async (withSlot) => withSlot({ env: {} }).env,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.slotWarning).toBeUndefined();
    expect(run.timing?.queueMs).toBe(0);
    expect(run.value[VALIDATION_SLOT_ENV]).toBe(held.token);
    expect(run.value[VALIDATION_SLOT_DIR_ENV]).toBe(slotDir);
    expect(lookups.count).toBe(0);
  });

  it("takes the slot in a token-less NDX_VALIDATION_SLOT_DIR, without the failing lookup", async () => {
    const slotDir = join(home, "handed-slot");
    const run = await runInValidationSlot(
      { projectDir: home, env: { [VALIDATION_SLOT_DIR_ENV]: slotDir } },
      async () => existsSync(join(slotDir, VALIDATION_SLOT_HOLDER_FILE)),
    );
    expect(run).toMatchObject({ ok: true, value: true });
    expect(run.ok && run.slotWarning).toBeFalsy();
    expect(existsSync(join(slotDir, VALIDATION_SLOT_HOLDER_FILE))).toBe(false);
    expect(lookups.count).toBe(0);
  });

  it("still runs unslotted and warns when it has no directory and the lookup fails", async () => {
    const run = await runInValidationSlot({ projectDir: home, env: {} }, async () => "ran");
    expect(run).toMatchObject({ ok: true, value: "ran" });
    expect(run.ok && run.slotWarning).toMatch(/could not read this host's machine id/);
    expect(lookups.count).toBe(1);
  });
});

describe("reclaimHostValidationSlot", () => {
  const holderRecord = (pid: number): string => JSON.stringify({
    version: 1, token: "11111111-2222-4333-8444-555555555555", pid, child: null,
    startedAt: new Date().toISOString(), bootedAt: currentBootTimeMs(), projectDir: "/elsewhere",
    pidNamespace: null, outerPidNamespaces: [],
  });
  /** This host's slot directory under the temp ndx home, with a holder record planted. */
  const plant = (pid: number): string => {
    const slotDir = join(home, VALIDATION_SLOT_DIRNAME, validationSlotHostDirname(IDENTITY));
    mkdirSync(slotDir, { recursive: true });
    writeFileSync(join(slotDir, VALIDATION_SLOT_HOLDER_FILE), holderRecord(pid));
    return join(slotDir, VALIDATION_SLOT_HOLDER_FILE);
  };
  const known = { peek: () => IDENTITY };

  it("removes a stale holder from this host's slot directory under the ndx home", async () => {
    const holder = plant(DEAD_PID);
    await reclaimHostValidationSlot({ NDX_HOME: home }, known);
    expect(existsSync(holder)).toBe(false);
  });

  it("keeps a live holder", async () => {
    const holder = plant(process.ppid);
    await reclaimHostValidationSlot({ NDX_HOME: home }, known);
    expect(existsSync(holder)).toBe(true);
  });

  it("reclaims in the directory NDX_VALIDATION_SLOT_DIR names, with no identity known", async () => {
    const holder = plant(DEAD_PID);
    const slotDir = join(holder, "..");
    await reclaimHostValidationSlot({ [VALIDATION_SLOT_DIR_ENV]: slotDir }, { peek: () => undefined });
    expect(existsSync(holder)).toBe(false);
  });

  it("returns at once while the host lookup is pending, starting one lookup and skipping this reclaim", async () => {
    const holder = plant(DEAD_PID);
    const pending = ioregSources(() => new Promise<LookupRun>(() => {}));
    const cache = createHostIdentityCache(pending);
    for (let i = 0; i < 3; i++) {
      expect(await settlesWithin(reclaimHostValidationSlot({ NDX_HOME: home }, cache), 1_000)).toBe(true);
    }
    expect(pending.runs).toBe(1);
    expect(existsSync(holder)).toBe(true);
  });

  it("runs a failing lookup once, not once per spawn, while the failure is remembered", async () => {
    const failing = ioregSources(async () => ({ kind: "exited", exitCode: 1, stdout: "" }));
    const cache = createHostIdentityCache(failing);
    await expect(cache()).rejects.toBeInstanceOf(HostIdentityLookupError);
    for (let i = 0; i < 3; i++) await reclaimHostValidationSlot({ NDX_HOME: home }, cache);
    expect(failing.runs).toBe(1);
  });
});

describe("withHostValidationSlotDir", () => {
  it("adds the host-resolved directory, and no token", () => {
    const env = withHostValidationSlotDir({ PATH: "/bin" }, { NDX_HOME: home }, { peek: () => IDENTITY });
    expect(env).toEqual({
      PATH: "/bin",
      [VALIDATION_SLOT_DIR_ENV]: join(home, VALIDATION_SLOT_DIRNAME, validationSlotHostDirname(IDENTITY)),
    });
  });

  it("keeps a directory the command was already given, such as a holder's", () => {
    const base = { [VALIDATION_SLOT_ENV]: "token", [VALIDATION_SLOT_DIR_ENV]: join(home, "holder-slot") };
    expect(withHostValidationSlotDir(base, { NDX_HOME: home }, { peek: () => IDENTITY })).toBe(base);
  });

  it("leaves the environment alone while the identity is not known", () => {
    const base = { PATH: "/bin" };
    expect(withHostValidationSlotDir(base, { NDX_HOME: home }, { peek: () => undefined })).toBe(base);
  });
});
