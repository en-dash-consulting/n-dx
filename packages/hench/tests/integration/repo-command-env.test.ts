import { afterEach, beforeEach, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { runDependencyAudit, runPostTaskTests, runTestGate } from "../../src/tools/test-runner.js";
import { createCommandExecutor } from "../../src/tools/rex.js";
import { describeNeedsPosixShell } from "../helpers/posix-shell.js";

/**
 * #686 finding 3: commands the repository owns (the test gate, post-task
 * tests, the dependency audit, requirement validation commands) inherited the
 * whole parent environment, so a test script could read a credential the
 * agent's shell is denied. Each runs here with a sentinel credential in the
 * parent environment and a command that reports only whether it is visible
 * (exit code or audit counts); the value is never printed.
 */

const SENTINEL = "NDX_SENTINEL_TOKEN";

/** Exits 0 when the sentinel is absent, 3 when the child can see it. */
const PROBE = `node -e "process.exit(process.env.${SENTINEL} === undefined ? 0 : 3)"`;

let projectDir: string;
let ndxHome: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hench-cmd-env-"));
  ndxHome = mkdtempSync(join(tmpdir(), "hench-cmd-env-home-"));
  mkdirSync(join(projectDir, "src"));
  writeFileSync(join(projectDir, "src", "a.ts"), "export const a = 1;\n");
  saved = { [SENTINEL]: process.env[SENTINEL], NDX_HOME: process.env.NDX_HOME, PATH: process.env.PATH };
  process.env[SENTINEL] = "sentinel";
  // An empty trust store, so the user's own cannot decide the outcome.
  process.env.NDX_HOME = ndxHome;
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(ndxHome, { recursive: true, force: true });
});

describeNeedsPosixShell("repository-owned commands get the sanitized environment", () => {
  it("the probe reports a sentinel it can see (control: an always-zero probe would prove nothing)", async () => {
    const result = await createCommandExecutor(projectDir)(`${SENTINEL}=x ${PROBE}`);
    expect(result.exitCode).toBe(3);
  });

  it("the test gate", async () => {
    const result = await runTestGate({ projectDir, filesChanged: ["src/a.ts"], testCommand: PROBE });
    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("post-task tests", async () => {
    const result = await runPostTaskTests({ projectDir, filesChanged: ["src/a.ts"], testCommand: PROBE });
    expect(result.ran).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("requirement validation commands", async () => {
    const result = await createCommandExecutor(projectDir)(PROBE);
    expect(result.exitCode).toBe(0);
  });

  it("a repository-supplied allow entry does not reach the gate while the repository is untrusted", async () => {
    mkdirSync(join(projectDir, ".hench"));
    writeFileSync(join(projectDir, ".hench", "config.json"), JSON.stringify({ guard: { env: { allow: [SENTINEL] } } }));
    const result = await runTestGate({ projectDir, filesChanged: ["src/a.ts"], testCommand: PROBE });
    expect(result.passed).toBe(true);
  });

  it("the dependency audit (pnpm audit and pnpm outdated)", async () => {
    // A stand-in pnpm that reports a finding from each step only when it can
    // see the sentinel.
    const bin = join(projectDir, "fake-bin");
    mkdirSync(bin);
    const pnpm = join(bin, "pnpm");
    writeFileSync(
      pnpm,
      [
        "#!/bin/sh",
        `if [ -n "\${${SENTINEL}+x}" ]; then seen=1; fi`,
        'case "$1" in',
        "  audit)",
        '    if [ -n "$seen" ]; then echo \'{"metadata":{"vulnerabilities":{"critical":0,"high":1,"moderate":0,"low":0}}}\';',
        "    else echo '{\"metadata\":{\"vulnerabilities\":{\"critical\":0,\"high\":0,\"moderate\":0,\"low\":0}}}'; fi ;;",
        "  outdated)",
        '    if [ -n "$seen" ]; then echo \'{"left-pad":{"current":"1.0.0","latest":"2.0.0"}}\'; else echo \'{}\'; fi ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(pnpm, 0o755);
    process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;

    const result = await runDependencyAudit({ projectDir });
    expect(result.ran).toBe(true);
    expect(result.vulnerabilities.high).toBe(0);
    expect(result.outdated.major).toEqual([]);
  });
});
