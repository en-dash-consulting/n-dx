/**
 * The repository's test runner takes the host validation slot from inside
 * the OS sandbox hench confines repository commands with. The sandbox denies
 * ndx home, so it carves out exactly `<ndx home>/validation-slot/`; without
 * that the runner failed with EPERM before any suite ran (PR #1035 review).
 *
 * The confined command is a stand-in for `scripts/run-all-tests.mjs`: a
 * script that takes the slot through the runner's own module
 * (scripts/lib/validation-slot.mjs, copied into the project with the one
 * module it imports), exactly as the runner does, without starting vitest
 * inside the sandbox. It also checks it cannot read the dashboard token or
 * the credential store, which proves it ran confined.
 *
 * Confinement is turned on explicitly, never taken from the ambient
 * NDX_SANDBOX (the suite's setup turns it off): the gate case runs in a child
 * process given NDX_SANDBOX=on, the agent-shell case passes the setting.
 *
 * Runs under Seatbelt and bubblewrap. bubblewrap gives the child its own PID
 * namespace, where the holder's pid outside reads as dead to `kill(pid, 0)`;
 * the slot recognises such a holder by its namespace instead (rule 4a), so
 * the gate case proves nesting and the queue case proves no reclaim there.
 * Skipped where no usable backend exists (Windows, a Linux host without
 * bwrap, a harness that is itself sandboxed).
 *
 * Uses the per-worker temp ndx home (tests/setup-ndx-home.js), never the
 * real one. The gate case runs the built hench (`dist/`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { detectSandboxBackend, resolveNdxHome } from "../../src/prd/llm-gateway.js";
import { execRepoShellCmd } from "../../src/guard/sandbox.js";
import { createVendorCliSandbox } from "../../src/guard/index.js";
import { exec } from "../../src/process/exec.js";
import { acquireValidationSlot, readValidationSlotHolder, VALIDATION_SLOT_ENV } from "../../src/process/validation-slot.js";
import { resolveValidationSlotDir } from "../../src/process/validation-slot-dir.js";

const REPO = join(import.meta.dirname, "../../../..");
const GATE_URL = pathToFileURL(join(import.meta.dirname, "../../dist/tools/test-runner.js")).href;
const on = { mode: "on" as const, toolNetwork: "none" as const, source: "env" as const };

/**
 * Takes the slot as run-all-tests.mjs does; exits 0 only when it nested or
 * held as `argv[2]` says and the token and credential store stayed unreadable.
 */
const TAKE_SLOT = `
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireValidationSlot, describeValidationSlotFailure, resolveValidationSlotDir } from "./scripts/lib/validation-slot.mjs";
import { resolveNdxHome } from "./packages/core/layout.js";

const unreadable = (name) => { try { readFileSync(join(resolveNdxHome(), name)); return false; } catch { return true; } };
if (!unreadable("auth.token") || !unreadable("credentials.json")) { console.error("ndx home secrets were readable"); process.exit(5); }

const slotDir = resolveValidationSlotDir();
let lease;
try {
  // A marker in the project (writable) once it queues behind another holder.
  lease = await acquireValidationSlot({
    slotDir, projectDir: process.cwd(), pollIntervalMs: 20,
    onWait: () => writeFileSync("waiting", ""),
  });
} catch (err) {
  for (const line of describeValidationSlotFailure(err, slotDir)) console.error(line);
  process.exit(4);
}
console.log(JSON.stringify({ nested: lease.nested }));
await lease.release();
process.exit(lease.nested === (process.argv[2] === "nested") ? 0 : 3);
`;

const host = detectSandboxBackend();
const live = host.available && (host.name === "seatbelt" || host.name === "bwrap");

describe.skipIf(!live)("the test runner's validation slot inside hench's sandbox", () => {
  let project: string;
  let slotDir: string;
  const planted: string[] = [];

  beforeEach(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "hench-slot-sbx-")));
    mkdirSync(join(project, "scripts", "lib"), { recursive: true });
    mkdirSync(join(project, "packages", "core"), { recursive: true });
    copyFileSync(join(REPO, "scripts", "lib", "validation-slot.mjs"), join(project, "scripts", "lib", "validation-slot.mjs"));
    copyFileSync(join(REPO, "packages", "core", "layout.js"), join(project, "packages", "core", "layout.js"));
    writeFileSync(join(project, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(project, "take-slot.mjs"), TAKE_SLOT);
    // Secrets the confined script must not read, beside the slot it may use.
    const ndxHome = resolveNdxHome();
    mkdirSync(ndxHome, { recursive: true });
    for (const name of ["auth.token", "credentials.json"]) {
      writeFileSync(join(ndxHome, name), "secret");
      planted.push(join(ndxHome, name));
    }
    slotDir = resolveValidationSlotDir();
  });

  afterEach(() => {
    for (const p of planted.splice(0)) rmSync(p, { force: true });
    rmSync(project, { recursive: true, force: true });
  });

  it("runs a gate whose command takes the runner's slot nested inside the gate's own slot", () => {
    // runTestGate reads NDX_SANDBOX from its process environment, so it runs
    // in a child given NDX_SANDBOX=on rather than by writing this worker's env.
    const script = `
      const { runTestGate } = await import(process.env.GATE_URL);
      const result = await runTestGate({
        projectDir: process.env.PROJECT, filesChanged: ["take-slot.mjs"],
        testCommand: "node take-slot.mjs nested", timeout: 60000,
        validationSlot: { slotDir: process.env.SLOT_DIR, projectDir: process.env.PROJECT, pollIntervalMs: 20 },
      });
      console.log(JSON.stringify(result));
    `;
    const env: NodeJS.ProcessEnv = { ...process.env, NDX_SANDBOX: "on", GATE_URL, PROJECT: project, SLOT_DIR: slotDir };
    delete env[VALIDATION_SLOT_ENV];
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: project, env, encoding: "utf-8", timeout: 90_000 });
    expect(out.status, out.stderr).toBe(0);
    const result = JSON.parse(out.stdout.trim().split("\n").pop()!);
    expect(result, JSON.stringify(result)).toMatchObject({ ran: true, passed: true });
    expect(result.executionMs).toBeGreaterThanOrEqual(0);
  });

  it("lets a confined command with no token take and release the slot (an agent's run_command)", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env[VALIDATION_SLOT_ENV];
    const result = await execRepoShellCmd("node take-slot.mjs held", { cwd: project, timeout: 60_000, env }, { setting: on });
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('"nested":false');
    expect(await readValidationSlotHolder(slotDir)).toBeNull();
  });

  it("lets the vendor CLI's confined shell take and release the slot", async () => {
    const sandbox = createVendorCliSandbox(project, "claude", { cliBinary: process.execPath, setting: on })!;
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env[VALIDATION_SLOT_ENV];
      const inv = sandbox.wrapShell("node take-slot.mjs held");
      const result = await exec(inv.file, inv.args, { cwd: project, timeout: 60_000, env: { ...env, ...inv.env } });
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      sandbox.dispose();
    }
    expect(await readValidationSlotHolder(slotDir)).toBeNull();
  });

  it("queues a confined runner behind a live holder, neither failing nor reclaiming its record", async () => {
    const holder = await acquireValidationSlot({ slotDir, projectDir: "/elsewhere", env: {} });
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env[VALIDATION_SLOT_ENV];
      const pending = execRepoShellCmd("node take-slot.mjs held", { cwd: project, timeout: 60_000, env }, { setting: on });
      // Release only once the runner reports it is waiting: a runner that
      // judged the live holder stale would take the slot without waiting,
      // never write the marker, and leave the holder's record replaced.
      await vi.waitFor(() => expect(existsSync(join(project, "waiting"))).toBe(true), { timeout: 30_000, interval: 20 });
      expect((await readValidationSlotHolder(slotDir))?.token).toBe(holder.token);
      await holder.release();
      const result = await pending;
      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
    } finally {
      await holder.release();
    }
  });
});
