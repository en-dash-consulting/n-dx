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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import * as hench from "../../packages/hench/dist/process/validation-slot.js";
import * as scripts from "../../scripts/lib/validation-slot.mjs";
import * as sandbox from "../../packages/llm-client/dist/sandbox.js";

const HENCH_MODULE = pathToFileURL(join(import.meta.dirname, "../../packages/hench/dist/process/validation-slot.js")).href;
const SCRIPTS_MODULE = pathToFileURL(join(import.meta.dirname, "../../scripts/lib/validation-slot.mjs")).href;

/** Takes the slot through the module at argv[1], prints its token, releases when stdin closes. */
const HOLDER_SCRIPT = `
const { acquireValidationSlot } = await import(process.argv[1]);
const lease = await acquireValidationSlot({ slotDir: process.argv[2], projectDir: "/holder", env: {} });
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
  const startHolder = () =>
    new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", HOLDER_SCRIPT, holderModule, slotDir], {
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
  const contendUntilWait = async (env = {}) => {
    const controller = new AbortController();
    let reported;
    const error = await contender
      .acquireValidationSlot({
        slotDir,
        projectDir: "/contender",
        env,
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
