import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmod, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { runPostTaskTests, runTestGate } from "../../src/tools/test-runner.js";
import type { TestGateResult } from "../../src/schema/v1.js";
import { validateCompletion } from "../../src/validation/completion.js";
import {
  acquireValidationSlot,
  VALIDATION_SLOT_ENV,
  VALIDATION_SLOT_HOLDER_FILE,
} from "../../src/process/validation-slot.js";
import { describeValidationSlotWait, type ValidationSlotRunOptions } from "../../src/process/validation-run.js";
import { describeNeedsPosixShell } from "../helpers/posix-shell.js";

describe("Test Suite Gate Integration", () => {
  let projectDir: string;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "hench-test-gate-"));
    projectDir = tmpDir;

    // Create a minimal project structure with a test file
    await mkdir(join(projectDir, "src"));
    await mkdir(join(projectDir, "tests"));
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        scripts: {
          test: "vitest --reporter=json",
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("skips gate when no files changed", async () => {
    const result = await runTestGate({
      projectDir,
      filesChanged: [],
    });

    expect(result.ran).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.packages).toHaveLength(0);
    expect(result.skipReason).toBe("No files modified in prior phases");
  });

  it("returns gate result with metadata", async () => {
    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/app.ts"],
      timeout: 5000,
    });

    expect(result).toHaveProperty("ran");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("packages");
    expect(result).toHaveProperty("totalDurationMs");
    expect(typeof result.totalDurationMs).toBe("number");
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes command in result when gate runs", async () => {
    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/foo.ts"],
      timeout: 5000,
    });

    // Only check if pnpm test is available on the system
    if (result.ran || result.error) {
      expect(result.command).toBe("pnpm test --reporter=json");
    }
  });

  it("returns structured gate result", async () => {
    const result: TestGateResult = await runTestGate({
      projectDir,
      filesChanged: ["src/index.ts"],
      timeout: 3000,
    });

    // Validate structure
    expect(typeof result.ran).toBe("boolean");
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.packages)).toBe(true);

    // If gate ran, packages should be an array
    if (result.ran) {
      for (const pkg of result.packages) {
        expect(typeof pkg.name).toBe("string");
        expect(typeof pkg.passed).toBe("boolean");
      }
    }
  });

  // Regression: a gate failure that no package accounts for used to be reported
  // as "0/0 package(s) failed" with an empty `Test gate failed: ` reason, which
  // is how a Windows run whose shell never launched aborted a good task without
  // saying why. A non-zero exit must always name something and explain itself.
  describe("failure with no attributable test output", () => {
    it("attributes the failure and records why", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        // Exits non-zero, prints nothing — the shape of an unlaunchable shell,
        // a missing script, or a runner that died before reporting.
        testCommand: `node -e "process.exit(3)"`,
        timeout: 20_000,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.packages.filter((p) => !p.passed)).toHaveLength(1);
      // The parser never returns an empty package list for a run that exited
      // non-zero: the fabricated workspace entry carries the diagnosis.
      expect(result.packages[0]!.failureOutput).toContain("produced no output");
    });

    // The gate runs a command STRING, so it needs a shell — and `sh` is not on
    // a stock Windows PATH. Proves the platform's shell is actually reached.
    it("runs the command through a shell that exists on this platform", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        testCommand: `node -e "process.stdout.write('shell-ok')"`,
        timeout: 20_000,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(true);
    });
  });

  describe("timeout", () => {
    it("kills a command that overruns the configured limit and says which knob moves it", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        // Sleeps well past the limit; the gate must cut it off, not wait.
        testCommand: `node -e "setTimeout(() => {}, 60000)"`,
        timeout: 1_500,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(false);
      // Attributable, like every other gate failure — not "0/0 package(s)".
      expect(result.packages.filter((p) => !p.passed)).toHaveLength(1);
      expect(result.error).toContain("did not finish within 2s");
      expect(result.error).toContain("hench.fullTestTimeoutMs");
      // failureOutput carries whatever the suite printed before the kill — the
      // hang's location when there is one; here the command printed nothing.
      expect(result.packages[0]!.failureOutput).toBe(
        "No output was produced before the timeout.",
      );
    });

    it("honours a raised limit for a command that finishes inside it", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        // Longer than the tight limit above, so a stale 1.5s ceiling would fail it.
        testCommand: `node -e "setTimeout(() => process.stdout.write('slow-ok'), 2500)"`,
        timeout: 30_000,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(2_000);
    });

    it("treats 0 as no limit rather than as an instant timeout", async () => {
      const result = await runTestGate({
        projectDir,
        filesChanged: ["src/index.ts"],
        testCommand: `node -e "setTimeout(() => process.stdout.write('ok'), 1200)"`,
        timeout: 0,
      });

      expect(result.ran).toBe(true);
      expect(result.passed).toBe(true);
    });
  });
});

/**
 * `hench.testGate.hostSlot`: each validation command takes the host-wide slot
 * for itself, sees its token as NDX_VALIDATION_SLOT, and gives it back
 * afterwards whatever the outcome. Uses a temp slot directory, never the
 * real ndx home.
 */
describeNeedsPosixShell("validation commands inside the host slot", () => {
  let projectDir: string;
  let slotDir: string;
  let probe: string;
  let childProbe: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-slot-"));
    slotDir = join(projectDir, ".slot");
    await mkdir(join(projectDir, "src"));
    await writeFile(join(projectDir, "src", "a.ts"), "export const a = 1;\n");
    // Exits 0 only when it runs as the slot's holder: holder.json exists and
    // its token is the one in NDX_VALIDATION_SLOT.
    const holderFile = JSON.stringify(join(slotDir, VALIDATION_SLOT_HOLDER_FILE));
    await writeFile(
      join(projectDir, "probe.cjs"),
      [
        `const fs = require("fs");`,
        `const token = process.env.${VALIDATION_SLOT_ENV};`,
        `let holder = null;`,
        `try { holder = JSON.parse(fs.readFileSync(${holderFile}, "utf-8")); } catch (err) { process.exit(6); }`,
        `process.exit(token && holder.token === token ? 0 : 5);`,
      ].join("\n"),
    );
    probe = `node ${JSON.stringify(join(projectDir, "probe.cjs"))}`;
    // Exits 0 only when holder.json names the command this probe runs in: on
    // POSIX its process group (the shell exec spawned leads it), on Windows a
    // plain pid. The record is written just after the spawn, so it polls; a
    // record that never comes is bounded by the command's own timeout.
    await writeFile(
      join(projectDir, "child-probe.cjs"),
      [
        `const fs = require("fs");`,
        `const { execFileSync } = require("child_process");`,
        `let child = null;`,
        `while (!child) {`,
        `  try { child = JSON.parse(fs.readFileSync(${holderFile}, "utf-8")).child; } catch (err) { child = null; }`,
        `  if (!child) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);`,
        `}`,
        `if (process.platform === "win32") process.exit(child.group === false ? 0 : 8);`,
        `const pgid = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf-8" }).trim());`,
        `process.exit(child.group === true && child.pid === pgid ? 0 : 9);`,
      ].join("\n"),
    );
    childProbe = `node ${JSON.stringify(join(projectDir, "child-probe.cjs"))}`;
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  const slot = (extra: Partial<ValidationSlotRunOptions> = {}): ValidationSlotRunOptions =>
    ({ slotDir, projectDir, pollIntervalMs: 20, ...extra });
  const slotHeld = () => existsSync(join(slotDir, VALIDATION_SLOT_HOLDER_FILE));
  /** Hold the slot as another holder would, for `ms`. */
  async function holdSlotFor(ms: number): Promise<void> {
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/elsewhere", env: {} });
    setTimeout(() => void lease.release(), ms);
  }

  it("runs the gate inside the slot, records queue and execution time, and releases it", async () => {
    const result = await runTestGate({ projectDir, filesChanged: ["src/a.ts"], testCommand: probe, validationSlot: slot() });
    expect(result.passed).toBe(true);
    expect(result.queueMs).toBeGreaterThanOrEqual(0);
    expect(result.executionMs).toBeGreaterThanOrEqual(0);
    expect(slotHeld()).toBe(false);
  });

  it("takes the slot again for the re-run and records both commands' time", async () => {
    const result = await runTestGate({
      projectDir,
      filesChanged: ["src/a.ts"],
      testCommand: `node -e "console.log('test-gate: failed-suites=root'); process.exit(1)"`,
      rerunTemplate: `${probe} {suites}`,
      validationSlot: slot(),
    });
    expect(result.rerun?.passed).toBe(true);
    expect(result.executionMs).toBeGreaterThanOrEqual(0);
    expect(slotHeld()).toBe(false);
  });

  it("releases the slot after a failing gate", async () => {
    const result = await runTestGate({
      projectDir, filesChanged: ["src/a.ts"], testCommand: `node -e "process.exit(1)"`, validationSlot: slot(),
    });
    expect(result.passed).toBe(false);
    expect(slotHeld()).toBe(false);
  });

  it("releases the slot after a timeout, once the command has been stopped", async () => {
    const result = await runTestGate({
      projectDir, filesChanged: ["src/a.ts"], testCommand: `node -e "setTimeout(() => {}, 30000)"`,
      timeout: 300, validationSlot: slot(),
    });
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/did not finish within/);
    expect(slotHeld()).toBe(false);
  });

  it("starts the gate's timeout after admission: queue wait does not count", async () => {
    await holdSlotFor(1_000);
    const result = await runTestGate({
      projectDir, filesChanged: ["src/a.ts"], testCommand: probe, timeout: 800, validationSlot: slot(),
    });
    expect(result.passed).toBe(true);
    expect(result.queueMs).toBeGreaterThanOrEqual(900);
  });

  it("reports the holder while waiting", async () => {
    await holdSlotFor(300);
    const waits: string[] = [];
    await runTestGate({
      projectDir, filesChanged: ["src/a.ts"], testCommand: probe,
      validationSlot: slot({ onWait: (w) => waits.push(describeValidationSlotWait(w)) }),
    });
    expect(waits[0]).toMatch(/^Waiting for the validation slot held by pid \d+ in \/elsewhere since /);
  });

  it("stops waiting when the run is interrupted, and runs nothing", async () => {
    const lease = await acquireValidationSlot({ slotDir, projectDir: "/elsewhere", env: {} });
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("interrupted")), 100);
      const result = await runTestGate({
        projectDir, filesChanged: ["src/a.ts"], testCommand: `node -e "require('fs').writeFileSync('ran', '')"`,
        validationSlot: slot({ signal: controller.signal }),
      });
      expect(result.ran).toBe(false);
      expect(result.error).toMatch(/validation slot.*interrupted/);
      expect(result.queueMs).toBeGreaterThanOrEqual(50);
      expect(existsSync(join(projectDir, "ran"))).toBe(false);
    } finally {
      await lease.release();
    }
  });

  it("records the gate command's child in holder.json while it runs, for each attempt and the re-run", async () => {
    const gate = await runTestGate({ projectDir, filesChanged: ["src/a.ts"], testCommand: childProbe, validationSlot: slot() });
    expect(gate.passed).toBe(true);

    const rerun = await runTestGate({
      projectDir,
      filesChanged: ["src/a.ts"],
      testCommand: `node -e "console.log('test-gate: failed-suites=root'); process.exit(1)"`,
      rerunTemplate: `${childProbe} {suites}`,
      validationSlot: slot(),
    });
    expect(rerun.rerun?.passed).toBe(true);
    expect(slotHeld()).toBe(false);
  });

  it("records the post-task and completion test commands' child in holder.json while they run", async () => {
    const postTask = await runPostTaskTests({ projectDir, filesChanged: ["src/a.ts"], testCommand: childProbe, validationSlot: slot() });
    expect(postTask.passed).toBe(true);

    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: projectDir });
    git("init", "-q");
    git("add", "src");
    git("commit", "-qm", "init");
    await writeFile(join(projectDir, "src", "a.ts"), "export const a = 2;\n");
    const completion = await validateCompletion(projectDir, { testCommand: childProbe, validationSlot: slot() });
    expect(completion.testsPassed).toBe(true);
    expect(slotHeld()).toBe(false);
  });

  it("runs post-task tests inside the slot", async () => {
    const result = await runPostTaskTests({ projectDir, filesChanged: ["src/a.ts"], testCommand: probe, validationSlot: slot() });
    expect(result.passed).toBe(true);
    expect(result.queueMs).toBeGreaterThanOrEqual(0);
    expect(result.executionMs).toBeGreaterThanOrEqual(0);
    expect(slotHeld()).toBe(false);
  });

  it("runs the completion check's test run inside the slot", async () => {
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: projectDir });
    git("init", "-q");
    git("add", "src");
    git("commit", "-qm", "init");
    await writeFile(join(projectDir, "src", "a.ts"), "export const a = 2;\n");
    const result = await validateCompletion(projectDir, { testCommand: probe, validationSlot: slot() });
    expect(result.testsPassed).toBe(true);
    expect(slotHeld()).toBe(false);
  });

  /** A slot directory that cannot be created: its parent is a regular file. */
  const unwritableSlot = () => slot({ slotDir: join(projectDir, "src", "a.ts", "slot") });
  const writesRan = `node -e "require('fs').writeFileSync('ran', '')"`;

  it("reports a slot that cannot be taken as a gate that did not run, without throwing", async () => {
    const result = await runTestGate({
      projectDir, filesChanged: ["src/a.ts"], testCommand: writesRan, validationSlot: unwritableSlot(),
    });
    expect(result.ran).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/could not take the validation slot/);
    expect(existsSync(join(projectDir, "ran"))).toBe(false);
  });

  it("reports a slot that cannot be taken from post-task tests and the completion check", async () => {
    const post = await runPostTaskTests({
      projectDir, filesChanged: ["src/a.ts"], testCommand: writesRan, validationSlot: unwritableSlot(),
    });
    expect(post.ran).toBe(false);
    expect(post.error).toMatch(/could not take the validation slot/);

    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: projectDir });
    git("init", "-q");
    git("add", "src");
    git("commit", "-qm", "init");
    await writeFile(join(projectDir, "src", "a.ts"), "export const a = 2;\n");
    const completion = await validateCompletion(projectDir, { testCommand: writesRan, validationSlot: unwritableSlot() });
    expect(completion.valid).toBe(false);
    expect(completion.testsRan).toBe(false);
    expect(completion.reason).toMatch(/could not take the validation slot/);
    expect(existsSync(join(projectDir, "ran"))).toBe(false);
  });

  it("keeps the command's result when the slot cannot be released, and warns", async () => {
    // The command replaces the slot directory with a file, so release fails with ENOTDIR.
    await writeFile(
      join(projectDir, "break-slot.cjs"),
      `const fs = require("fs");\n` +
        `fs.rmSync(${JSON.stringify(slotDir)}, { recursive: true, force: true });\n` +
        `fs.writeFileSync(${JSON.stringify(slotDir)}, "");\n`,
    );
    const warnings: string[] = [];
    const result = await runTestGate({
      projectDir, filesChanged: ["src/a.ts"], testCommand: `node ${JSON.stringify(join(projectDir, "break-slot.cjs"))}`,
      validationSlot: slot({ onWarning: (w) => warnings.push(w) }),
    });
    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/could not release the validation slot/);
  });

  // Root ignores directory permissions, so the read-only slot cannot fail its release.
  it.skipIf(process.getuid?.() === 0)(
    "reclaims a record it could not release on its next validation instead of waiting on itself",
    async () => {
      // The command makes the slot directory read-only: release cannot unlink
      // holder.json, which stays behind naming this process.
      await writeFile(
        join(projectDir, "lock-slot.cjs"),
        `require("fs").chmodSync(${JSON.stringify(slotDir)}, 0o555);\n`,
      );
      const warnings: string[] = [];
      const first = await runTestGate({
        projectDir, filesChanged: ["src/a.ts"], testCommand: `node ${JSON.stringify(join(projectDir, "lock-slot.cjs"))}`,
        validationSlot: slot({ onWarning: (w) => warnings.push(w) }),
      });
      await chmod(slotDir, 0o755);
      expect(first.passed).toBe(true);
      expect(warnings[0]).toMatch(/could not release the validation slot/);
      expect(slotHeld()).toBe(true);

      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(new Error("waited on its own record")), 5_000);
      try {
        const second = await runTestGate({
          projectDir, filesChanged: ["src/a.ts"], testCommand: probe, validationSlot: slot({ signal: controller.signal }),
        });
        expect(second.error).toBeUndefined();
        expect(second.passed).toBe(true);
        expect(slotHeld()).toBe(false);
      } finally {
        clearTimeout(deadline);
      }
    },
  );

  it("without a slot, takes none and records no timing", async () => {
    const result = await runTestGate({ projectDir, filesChanged: ["src/a.ts"], testCommand: `node -e "process.exit(0)"` });
    expect(result.passed).toBe(true);
    expect(result).not.toHaveProperty("queueMs");
    expect(result).not.toHaveProperty("executionMs");
    expect(existsSync(slotDir)).toBe(false);
  });
});
