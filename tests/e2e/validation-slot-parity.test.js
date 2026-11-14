/**
 * Validation slot parity: hench's slot module and the test runner's
 * (`scripts/lib/validation-slot.mjs`) implement one on-disk protocol, and
 * must exclude each other and honour each other's token.
 *
 * `packages/hench/src/process/validation-slot.ts` is canonical; its header
 * documents the protocol. Scripts cannot import hench, so the runner
 * reimplements it. A hench gate and a hand-started `pnpm test` that disagree
 * about the files run together and load the machine twice, or deadlock when
 * a gate's runner fails to recognise the gate's token.
 *
 * Each case holds the slot in a separate process through one implementation
 * and contends from this process through the other, both ways round, against
 * one temp ndx home. The test reads hench's built dist (verify-build.js).
 *
 * The slot directory is resolved twice as well (hench's
 * `validation-slot-dir.ts`): both copies must name the same per-host
 * directory, or a gate and a runner on one machine never meet.
 *
 * If this fails: apply the change to BOTH modules.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import * as hench from "../../packages/hench/dist/process/validation-slot.js";
import * as henchDir from "../../packages/hench/dist/process/validation-slot-dir.js";
import * as scripts from "../../scripts/lib/validation-slot.mjs";
import * as sandbox from "../../packages/llm-client/dist/sandbox.js";

const HENCH_MODULE = pathToFileURL(join(import.meta.dirname, "../../packages/hench/dist/process/validation-slot.js")).href;
const HENCH_DIR_MODULE = pathToFileURL(join(import.meta.dirname, "../../packages/hench/dist/process/validation-slot-dir.js")).href;
const SCRIPTS_MODULE = pathToFileURL(join(import.meta.dirname, "../../scripts/lib/validation-slot.mjs")).href;

/** A pid no process holds (above any OS's pid range). */
const DEAD_PID = 2 ** 30;

/**
 * Takes the slot through the module at argv[1], prints its token and the
 * environment it hands its children, releases when stdin closes. argv[3] and
 * argv[4], when given, are the /proc it reads its PID namespace from and its
 * NDX_OUTER_PID_NAMESPACES.
 */
const HOLDER_SCRIPT = `
const { acquireValidationSlot } = await import(process.argv[1]);
const env = process.argv[4] ? { NDX_OUTER_PID_NAMESPACES: process.argv[4] } : {};
const lease = await acquireValidationSlot({ slotDir: process.argv[2], projectDir: "/holder", env, procRoot: process.argv[3] || undefined });
process.stdout.write(JSON.stringify({ token: lease.token, childEnv: lease.childEnv({}) }) + "\\n");
process.stdin.on("end", async () => { await lease.release(); process.stdout.write("released\\n"); });
process.stdin.resume();
`;

const DIRECTIONS = [
  { name: "hench holds, the runner contends", holderModule: HENCH_MODULE, contender: scripts, contenderModule: SCRIPTS_MODULE },
  { name: "the runner holds, hench contends", holderModule: SCRIPTS_MODULE, contender: hench, contenderModule: HENCH_MODULE },
];

/** Acquires nested through the module at argv[1] on the token at argv[3]; exits 0 only when nested. */
const NESTED_SCRIPT = `
const { acquireValidationSlot } = await import(process.argv[1]);
const lease = await acquireValidationSlot({ slotDir: process.argv[2], projectDir: "/nested", env: { NDX_VALIDATION_SLOT: process.argv[3] } });
process.exit(lease.nested ? 0 : 3);
`;

/**
 * Preload that makes every write either implementation could make fail with
 * EPERM, as a sandbox that grants only read access would. Both import these
 * as named bindings from node:fs/promises; syncBuiltinESMExports carries the
 * replacement to those bindings.
 */
const DENY_WRITES = `data:text/javascript,${encodeURIComponent(`
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const deny = (name) => async (path) => { throw Object.assign(new Error("EPERM: " + name + " denied: " + path), { code: "EPERM" }); };
for (const name of ["mkdir", "writeFile", "link", "rename", "unlink"]) fsp[name] = deny(name);
syncBuiltinESMExports();
`)}`;

/**
 * Preload that, the first time either implementation removes a holder.json,
 * first replaces the reclaim.lock beside it with THEIR_LOCK and keeps the one
 * it replaced: another waiter judging this process's lock stale and taking
 * the lock over while this process still reclaims under it.
 */
const REPLACE_LOCK = `data:text/javascript,${encodeURIComponent(`
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const { unlink, readFile, writeFile } = fsp;
let replaced = false;
fsp.unlink = async (path) => {
  const p = String(path);
  if (!replaced && p.endsWith("holder.json")) {
    replaced = true;
    const lock = p.slice(0, -"holder.json".length) + "reclaim.lock";
    globalThis.replacedLock = await readFile(lock, "utf-8");
    await writeFile(lock, process.env.THEIR_LOCK, "utf-8");
  }
  return unlink(path);
};
syncBuiltinESMExports();
`)}`;

/** Takes and releases the slot through the module at argv[1]; prints the reclaim.lock it had replaced. */
const RECLAIM_SCRIPT = `
const { acquireValidationSlot } = await import(process.argv[1]);
const lease = await acquireValidationSlot({ slotDir: process.argv[2], projectDir: "/reclaimer", env: {}, signal: AbortSignal.timeout(10_000) });
await lease.release();
process.stdout.write(JSON.stringify({ pid: process.pid, replaced: globalThis.replacedLock ?? null }));
`;

/** A holder record, as either implementation writes it; omitted namespace fields read as null and []. */
const holderRecord = (fields) =>
  JSON.stringify({
    version: 1, token: "previous-owner", pid: process.pid, child: null,
    startedAt: "2026-11-14T00:00:00.000Z", bootedAt: hench.currentBootTimeMs(), projectDir: "/elsewhere",
    ...fields,
  });

/** A file read or failure as the platform lookups see them. */
const notFound = () => Promise.reject(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }));
const denied = () => Promise.reject(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
const MACHINE_ID = "0123456789abcdef0123456789ABCDEF";
const IOREG = `| "IOPlatformUUID" = "${MACHINE_ID}"\n`;
const REG = `    MachineGuid    REG_SZ    ${MACHINE_ID}\r\n`;

/** Lookup sources for one scenario: files by path, one command result, the hostname. */
const sources = (platform, { files = {}, run = { kind: "missing" } } = {}) => ({
  platform,
  readFile: (path) => (files[path] ? files[path]() : notFound()),
  run: async () => run,
  hostname: () => "Some-Host.local",
});

const IDENTITY_SCENARIOS = [
  ["linux, /etc/machine-id", sources("linux", { files: { "/etc/machine-id": async () => `${MACHINE_ID}\n` } })],
  ["linux, dbus id only", sources("linux", { files: { "/var/lib/dbus/machine-id": async () => MACHINE_ID } })],
  ["linux, unset id", sources("linux", { files: { "/etc/machine-id": async () => "uninitialized\n" } })],
  ["linux, no files", sources("linux")],
  ["linux, unreadable then absent", sources("linux", { files: { "/etc/machine-id": denied } })],
  ["linux, unreadable then found", sources("linux", { files: { "/etc/machine-id": denied, "/var/lib/dbus/machine-id": async () => MACHINE_ID } })],
  ["darwin, ioreg answers", sources("darwin", { run: { kind: "exited", exitCode: 0, stdout: IOREG } })],
  ["darwin, ioreg answers without an id", sources("darwin", { run: { kind: "exited", exitCode: 0, stdout: "" } })],
  ["darwin, ioreg fails with an id", sources("darwin", { run: { kind: "exited", exitCode: 1, stdout: IOREG } })],
  ["darwin, ioreg fails without an id", sources("darwin", { run: { kind: "exited", exitCode: 1, stdout: "" } })],
  ["darwin, ioreg missing", sources("darwin")],
  ["darwin, ioreg times out", sources("darwin", { run: { kind: "failed", reason: "Command timed out after 10000ms" } })],
  ["win32, reg answers", sources("win32", { run: { kind: "exited", exitCode: 0, stdout: REG } })],
  ["win32, reg fails", sources("win32", { run: { kind: "exited", exitCode: 1, stdout: "" } })],
  ["freebsd", sources("freebsd")],
];

/** What one copy makes of a lookup: the directory name, or the error. */
const lookupOutcome = (copy, src) =>
  copy.readHostIdentity(src).then(
    (identity) => ({ identity, dirname: copy.validationSlotHostDirname(identity) }),
    (err) => ({ error: err.name, message: err.message }),
  );

describe("validation slot parity: the per-host slot directory", () => {
  it.each(IDENTITY_SCENARIOS)("reads the same host identity: %s", async (_name, src) => {
    expect(await lookupOutcome(scripts, src)).toEqual(await lookupOutcome(henchDir, src));
  });

  it("resolves the same directory from an injected identity, under the root the sandbox grants", async () => {
    const home = mkdtempSync(join(tmpdir(), "slot-parity-dir-"));
    try {
      const env = { N_DX_HOME: home };
      for (const identity of [{ kind: "machine", id: MACHINE_ID }, { kind: "hostname", id: " Some-Host.local " }]) {
        const dir = await scripts.resolveValidationSlotDir(env, identity);
        expect(dir).toBe(await henchDir.resolveValidationSlotDir(env, identity));
        expect(dir).toMatch(/[\\/]validation-slot[\\/][mh]-[0-9a-f]{16}$/);
      }
      expect(scripts.validationSlotRootDir(env)).toBe(join(home, hench.VALIDATION_SLOT_DIRNAME));
      // The one ndx-home directory the OS sandbox grants holds every host's slot.
      expect(sandbox.validationSlotDirFor({ kind: "tool", projectDir: "/p", tmpDir: "/t", network: "none", ndxHome: home }))
        .toBe(scripts.validationSlotRootDir(env));
      expect(scripts.LOOKUP_TIMEOUT_MS).toBe(henchDir.LOOKUP_TIMEOUT_MS);
      expect(scripts.LINUX_MACHINE_ID_FILES).toEqual([...henchDir.LINUX_MACHINE_ID_FILES]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("caches a found or absent identity, and retries a transient failure", async () => {
    for (const copy of [scripts, henchDir]) {
      let calls = 0;
      const results = [{ kind: "failed", reason: "timed out" }, { kind: "missing" }];
      const flaky = { ...sources("darwin"), run: async () => results[Math.min(calls++, results.length - 1)] };
      const identity = copy.createHostIdentityCache(flaky);
      await expect(identity()).rejects.toThrow(/could not read this host's machine id/);
      expect(await identity()).toEqual({ kind: "hostname", id: "Some-Host.local" });
      await identity();
      expect(calls).toBe(2);
    }
  });

  // The real lookup, one copy in each of two processes, as a gate and a runner on one host.
  it("resolves the same directory on this host from two processes, one per copy", async () => {
    const env = { N_DX_HOME: tmpdir() };
    const henchSide = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `const m = await import(process.argv[1]); process.stdout.write(await m.resolveValidationSlotDir({ N_DX_HOME: process.argv[2] }));`, HENCH_DIR_MODULE, env.N_DX_HOME],
      { encoding: "utf-8", timeout: 30_000, windowsHide: true },
    );
    expect(henchSide.status, henchSide.stderr).toBe(0);
    expect(await scripts.resolveValidationSlotDir(env)).toBe(henchSide.stdout);
  });
});

describe.each(DIRECTIONS)("validation slot parity: $name", ({ holderModule, contender, contenderModule }) => {
  let home;
  let slotDir;
  let holder;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slot-parity-home-"));
    slotDir = join(home, "validation-slot");
  });
  afterEach(() => {
    holder?.child.kill("SIGKILL");
    holder = undefined;
    rmSync(home, { recursive: true, force: true });
  });

  /** Start the holder process; resolves once it holds the slot. */
  const startHolder = (procRoot = "", outer = "") =>
    new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", HOLDER_SCRIPT, holderModule, slotDir, procRoot, outer], {
        stdio: ["pipe", "pipe", "inherit"],
        windowsHide: true,
      });
      const lines = createInterface({ input: child.stdout });
      const next = () => new Promise((r) => lines.once("line", r));
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`holder exited (${code}) before taking the slot`)));
      next().then((line) => {
        const { token, childEnv } = JSON.parse(line);
        holder = { child, token, childEnv, next };
        resolvePromise(holder);
      });
    });

  /** Contend until the first wait report, then give up; resolves with that report. */
  const contendUntilWait = async (env = {}, procRoot = undefined) => {
    const controller = new AbortController();
    let reported;
    const error = await contender
      .acquireValidationSlot({
        slotDir,
        projectDir: "/contender",
        env,
        procRoot,
        signal: controller.signal,
        pollIntervalMs: 10,
        onWait: (wait) => {
          reported = wait;
          controller.abort();
        },
      })
      .then(
        () => null,
        (err) => err,
      );
    expect(error?.name).toBe("ValidationSlotAbortedError");
    return reported;
  };

  it("names the same environment variables", () => {
    expect(scripts.VALIDATION_SLOT_ENV).toBe(hench.VALIDATION_SLOT_ENV);
    expect(scripts.VALIDATION_SLOT_DIR_ENV).toBe(hench.VALIDATION_SLOT_DIR_ENV);
    expect(scripts.VALIDATION_SLOT_DIRNAME).toBe(hench.VALIDATION_SLOT_DIRNAME);
    // The variable bubblewrap sets for a confined child is the one both read (rule 4a).
    expect(scripts.OUTER_PID_NAMESPACES_ENV).toBe(hench.OUTER_PID_NAMESPACES_ENV);
    expect(sandbox.OUTER_PID_NAMESPACES_ENV).toBe(hench.OUTER_PID_NAMESPACES_ENV);
  });

  // Rule 4a against fake /proc trees: OUTER is the host, INNER a bubblewrap
  // sandbox inside it. A holder killed after taking the slot leaves a record
  // whose pid is dead, which only its namespace keeps from reading as stale.
  // The fake trees use symlinks, which Windows reserves to administrators.
  describe.skipIf(process.platform === "win32")("PID namespaces (rule 4a)", () => {
    const OUTER = "pid:[4026531836]";
    const INNER = "pid:[4026532001]";

    /** A fake /proc whose own namespace is `ns`, listing `procs` as [entry, ns, pid]. */
    const fakeProc = (ns, procs = []) => {
      const root = join(home, `proc-${ns.replace(/\D/g, "")}-${procs.length}`);
      mkdirSync(join(root, "self", "ns"), { recursive: true });
      symlinkSync(ns, join(root, "self", "ns", "pid"));
      for (const [entry, entryNs, pid] of procs) {
        mkdirSync(join(root, String(entry), "ns"), { recursive: true });
        symlinkSync(entryNs, join(root, String(entry), "ns", "pid"));
        writeFileSync(join(root, String(entry), "status"), `NSpid:\t${entry}\t${pid}\nNSpgid:\t${entry}\t${pid}\n`);
      }
      return root;
    };

    /** A holder that took the slot in `ns` and was then killed; resolves with its token. */
    const deadHolderIn = async (procRoot, outer = "") => {
      const { child, token } = await startHolder(procRoot, outer);
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGKILL");
      await exited;
      holder = undefined;
      return { token, raw: readFileSync(join(slotDir, "holder.json"), "utf-8") };
    };

    it("inside a sandbox, nests on the token of a holder outside it", async () => {
      const { token, raw } = await deadHolderIn(fakeProc(OUTER));
      const lease = await contender.acquireValidationSlot({
        slotDir,
        projectDir: "/contender",
        env: { NDX_VALIDATION_SLOT: token, NDX_OUTER_PID_NAMESPACES: OUTER },
        procRoot: fakeProc(INNER),
      });
      expect(lease.nested).toBe(true);
      expect(readFileSync(join(slotDir, "holder.json"), "utf-8")).toBe(raw);
    });

    it("inside a sandbox, waits for a holder outside it and never reclaims its record", async () => {
      const { raw } = await deadHolderIn(fakeProc(OUTER));
      const wait = await contendUntilWait({ NDX_OUTER_PID_NAMESPACES: OUTER }, fakeProc(INNER));
      expect(wait.holderAlive).toBe(true);
      expect(readFileSync(join(slotDir, "holder.json"), "utf-8")).toBe(raw);
    });

    // Rule 5a holds only within one namespace: outside the sandbox this pid is another process's.
    it("inside a sandbox, never takes a record from outside it for one naming its own pid", async () => {
      mkdirSync(slotDir, { recursive: true });
      const raw = holderRecord({ pidNamespace: OUTER, outerPidNamespaces: [] });
      writeFileSync(join(slotDir, "holder.json"), raw, "utf-8");
      const wait = await contendUntilWait({ NDX_OUTER_PID_NAMESPACES: OUTER }, fakeProc(INNER));
      expect(wait.holderAlive).toBe(true);
      expect(readFileSync(join(slotDir, "holder.json"), "utf-8")).toBe(raw);
    });

    it("outside a sandbox, reads a holder inside it by its pid there", async () => {
      const { raw } = await deadHolderIn(fakeProc(INNER), OUTER);
      const record = JSON.parse(raw);
      expect(record).toMatchObject({ pidNamespace: INNER, outerPidNamespaces: [OUTER] });
      // Still running inside the sandbox: waited for.
      const wait = await contendUntilWait({}, fakeProc(OUTER, [[9001, INNER, record.pid]]));
      expect(wait.holderAlive).toBe(true);
      // Gone from the sandbox: reclaimed.
      const lease = await contender.acquireValidationSlot({ slotDir, projectDir: "/contender", env: {}, procRoot: fakeProc(OUTER) });
      expect(lease.nested).toBe(false);
      await lease.release();
    });

    // A process in the reader's own namespace (one NSpid entry) whose ns/pid
    // refuses, as a non-dumpable process of the same user does on Linux.
    it.skipIf(process.getuid?.() === 0)(
      "outside a sandbox, reclaims a gone holder's record despite an uninspectable process in its own namespace",
      async () => {
        await deadHolderIn(fakeProc(INNER), OUTER);
        const procRoot = fakeProc(OUTER);
        mkdirSync(join(procRoot, "9005", "ns"), { recursive: true });
        symlinkSync(OUTER, join(procRoot, "9005", "ns", "pid"));
        writeFileSync(join(procRoot, "9005", "status"), "NSpid:\t9005\nNSpgid:\t9005\n");
        chmodSync(join(procRoot, "9005", "ns"), 0o000);
        try {
          const lease = await contender.acquireValidationSlot({
            slotDir, projectDir: "/contender", env: {}, procRoot, signal: AbortSignal.timeout(10_000),
          });
          expect(lease.nested).toBe(false);
          await lease.release();
        } finally {
          chmodSync(join(procRoot, "9005", "ns"), 0o755);
        }
      },
    );

    // The real /proc, where root's processes refuse a non-root reader their
    // ns/pid: they are not this user's sandbox and must not keep its record.
    it.runIf(process.platform === "linux" && process.getuid?.() !== 0 && existsSync("/proc/self/ns/pid"))(
      "on a real /proc, reclaims a gone sandbox's record despite other users' unreadable processes",
      async () => {
        const own = readlinkSync("/proc/self/ns/pid");
        const { child } = await startHolder(fakeProc(INNER), own);
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGKILL");
        await exited;
        holder = undefined;
        const lease = await contender.acquireValidationSlot({
          slotDir, projectDir: "/contender", env: {}, pollIntervalMs: 10, signal: AbortSignal.timeout(10_000),
        });
        expect(lease.nested).toBe(false);
        await lease.release();
      },
    );
  });

  it("excludes the other implementation while it holds, and admits it once released", async () => {
    const { child, next } = await startHolder();
    const wait = await contendUntilWait();
    expect(wait.holder.pid).toBe(child.pid);
    expect(wait.holder.projectDir).toBe("/holder");
    expect(wait.holderAlive).toBe(true);

    child.stdin.end();
    expect(await next()).toBe("released");
    const lease = await contender.acquireValidationSlot({ slotDir, projectDir: "/contender", env: {} });
    expect(lease.nested).toBe(false);
    await lease.release();
    expect(existsSync(join(slotDir, "holder.json"))).toBe(false);
  });

  it("runs nested on the other implementation's token, and never releases its slot", async () => {
    const { token } = await startHolder();
    const lease = await contender.acquireValidationSlot({
      slotDir,
      projectDir: "/contender",
      env: { NDX_VALIDATION_SLOT: token },
    });
    expect(lease.nested).toBe(true);
    expect(lease.queueWaitMs).toBe(0);
    await lease.release();
    expect((await hench.readValidationSlotHolder(slotDir))?.token).toBe(token);
    expect((await scripts.readValidationSlotHolder(slotDir))?.token).toBe(token);
  });

  // A process that may read the slot but not write it (rule 6): the nesting
  // check reads holder.json before anything creates or writes there.
  it("runs nested where every write to the filesystem fails", async () => {
    const { token } = await startHolder();
    const nested = spawnSync(
      process.execPath,
      ["--import", DENY_WRITES, "--input-type=module", "-e", NESTED_SCRIPT, contenderModule, slotDir, token],
      { encoding: "utf-8", timeout: 30_000, windowsHide: true },
    );
    expect(nested.status, nested.stderr).toBe(0);
    expect((await scripts.readValidationSlotHolder(slotDir))?.token).toBe(token);
  });

  it("ignores a token for a holder that is gone, and reclaims its record", async () => {
    const { child, token } = await startHolder();
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGKILL");
    await exited;
    const lease = await contender.acquireValidationSlot({
      slotDir,
      projectDir: "/contender",
      env: { NDX_VALIDATION_SLOT: token },
    });
    expect(lease.nested).toBe(false);
    expect(lease.token).not.toBe(token);
    await lease.release();
    // The reclaimer removed its own reclaim.lock.
    expect(existsSync(join(slotDir, "reclaim.lock"))).toBe(false);
  });

  // Rule 6: the holder hands down its directory, and a nested acquire whose
  // own directory resolves elsewhere still nests in the holder's.
  it("hands its children the slot directory, and nests there from a different directory", async () => {
    const { token, childEnv } = await startHolder();
    expect(childEnv).toEqual({ NDX_VALIDATION_SLOT: token, NDX_VALIDATION_SLOT_DIR: slotDir });
    const elsewhere = join(home, "validation-slot", "h-0000000000000000");
    const lease = await contender.acquireValidationSlot({ slotDir: elsewhere, projectDir: "/contender", env: childEnv });
    expect(lease.nested).toBe(true);
    expect(lease.slotDir).toBe(slotDir);
    expect(lease.childEnv({})).toEqual(childEnv);
    expect(existsSync(elsewhere)).toBe(false);
    // Without the directory, the token names no holder of `elsewhere`: it takes that slot.
    const own = await contender.acquireValidationSlot({ slotDir: elsewhere, projectDir: "/contender", env: { NDX_VALIDATION_SLOT: token } });
    expect(own.nested).toBe(false);
    await own.release();
  });

  // Rule 5a: a record or lock naming this process's pid with a token it does
  // not hold was left by an earlier process whose pid this one now has.
  describe("own pid (rule 5a)", () => {
    beforeEach(() => mkdirSync(slotDir, { recursive: true }));
    const writeSlotFile = (name, content) => writeFileSync(join(slotDir, name), content, "utf-8");
    const contend = () =>
      contender.acquireValidationSlot({ slotDir, projectDir: "/contender", env: {}, pollIntervalMs: 10, signal: AbortSignal.timeout(10_000) });

    it("reclaims a record naming this pid with a token it does not hold", async () => {
      writeSlotFile("holder.json", holderRecord({}));
      const lease = await contend();
      expect((await hench.readValidationSlotHolder(slotDir))?.token).toBe(lease.token);
      await lease.release();
    });

    it("waits on such a record while its test child runs, reporting its holder as exited", async () => {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
      try {
        const raw = holderRecord({ child: { pid: child.pid, group: false } });
        writeSlotFile("holder.json", raw);
        const wait = await contendUntilWait();
        expect(wait.holderAlive).toBe(false);
        // The wait report names the file to delete when the slot is wedged.
        expect(wait.holderPath).toBe(join(slotDir, "holder.json"));
        expect(scripts.describeValidationSlotWait(wait)).toBe(
          `Waiting for the validation slot held by pid ${process.pid} (exited; its tests still run) in /elsewhere ` +
            `since 2026-11-14T00:00:00.000Z (${join(slotDir, "holder.json")})`,
        );
        expect(readFileSync(join(slotDir, "holder.json"), "utf-8")).toBe(raw);
      } finally {
        child.kill("SIGKILL");
      }
    });

    it("clears a reclaim.lock naming this pid with a token it does not hold", async () => {
      writeSlotFile("holder.json", holderRecord({ pid: DEAD_PID }));
      writeSlotFile("reclaim.lock", JSON.stringify({ pid: process.pid, token: "previous-reclaimer", startedAt: "2026-11-14T00:00:00.000Z" }));
      const lease = await contend();
      expect(existsSync(join(slotDir, "reclaim.lock"))).toBe(false);
      await lease.release();
    });
  });

  // Rule 5: the reclaimer removes reclaim.lock only while it is still its own.
  it("leaves a reclaim.lock that replaced its own while it reclaimed", () => {
    mkdirSync(slotDir, { recursive: true });
    writeFileSync(join(slotDir, "holder.json"), holderRecord({ pid: DEAD_PID }), "utf-8");
    const theirs = JSON.stringify({ pid: process.pid, token: "other-waiter", startedAt: "2026-11-14T00:00:00.000Z" });
    const reclaimer = spawnSync(
      process.execPath,
      ["--import", REPLACE_LOCK, "--input-type=module", "-e", RECLAIM_SCRIPT, contenderModule, slotDir],
      { encoding: "utf-8", timeout: 30_000, windowsHide: true, env: { ...process.env, THEIR_LOCK: theirs } },
    );
    expect(reclaimer.status, reclaimer.stderr).toBe(0);
    const { pid, replaced } = JSON.parse(reclaimer.stdout);
    expect(JSON.parse(replaced)).toMatchObject({ pid });
    expect(readFileSync(join(slotDir, "reclaim.lock"), "utf-8")).toBe(theirs);
  });
});
