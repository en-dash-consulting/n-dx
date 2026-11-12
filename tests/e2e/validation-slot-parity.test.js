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
 * If this fails: apply the change to BOTH modules.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import * as hench from "../../packages/hench/dist/process/validation-slot.js";
import * as scripts from "../../scripts/lib/validation-slot.mjs";
import * as sandbox from "../../packages/llm-client/dist/sandbox.js";

const HENCH_MODULE = pathToFileURL(join(import.meta.dirname, "../../packages/hench/dist/process/validation-slot.js")).href;
const SCRIPTS_MODULE = pathToFileURL(join(import.meta.dirname, "../../scripts/lib/validation-slot.mjs")).href;

/**
 * Takes the slot through the module at argv[1], prints its token, releases
 * when stdin closes. argv[3] and argv[4], when given, are the /proc it reads
 * its PID namespace from and its NDX_OUTER_PID_NAMESPACES.
 */
const HOLDER_SCRIPT = `
const { acquireValidationSlot } = await import(process.argv[1]);
const env = process.argv[4] ? { NDX_OUTER_PID_NAMESPACES: process.argv[4] } : {};
const lease = await acquireValidationSlot({ slotDir: process.argv[2], projectDir: "/holder", env, procRoot: process.argv[3] || undefined });
process.stdout.write(JSON.stringify({ token: lease.token }) + "\\n");
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
        holder = { child, token: JSON.parse(line).token, next };
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

  it("resolves the same slot directory from one ndx home", () => {
    const env = { N_DX_HOME: home };
    expect(scripts.resolveValidationSlotDir(env)).toBe(join(home, hench.VALIDATION_SLOT_DIRNAME));
    // The one ndx-home directory the OS sandbox grants must be this one.
    expect(sandbox.validationSlotDirFor({ kind: "tool", projectDir: "/p", tmpDir: "/t", network: "none", ndxHome: home }))
      .toBe(join(home, hench.VALIDATION_SLOT_DIRNAME));
    expect(scripts.VALIDATION_SLOT_ENV).toBe(hench.VALIDATION_SLOT_ENV);
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
  });
});
