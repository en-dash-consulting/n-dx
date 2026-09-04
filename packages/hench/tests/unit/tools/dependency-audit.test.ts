import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExecResult } from "../../../src/process/exec.js";

/**
 * An audit that could not run is not an audit that found nothing.
 *
 * `exec` reports a spawn failure as exitCode 1 with empty stdout, so the parse
 * was skipped, the all-zero initializer was returned untouched, and
 * `runDependencyAudit` answered `ran: true` with "no vulnerabilities" for a
 * `pnpm audit` that never started. That fails OPEN, which is the wrong direction
 * for a security-adjacent check and is worse than being loudly wrong: it is
 * silently reassuring.
 *
 * These drive `launched` directly rather than arranging a real spawn failure,
 * because the interesting input is exactly that field and a genuine ENOENT is
 * not reproducible across platforms.
 */

/** A clean `pnpm audit --json` payload: parses, and reports zero of everything. */
const CLEAN_AUDIT_JSON = JSON.stringify({
  actions: [],
  advisories: {},
  metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } },
});

/** A `pnpm audit --json` payload with one high-severity finding. */
const DIRTY_AUDIT_JSON = JSON.stringify({
  metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0 } },
  vulnerabilities: {
    "left-pad": { version: "1.0.0", via: [{ severity: "high" }] },
  },
});

function execResult(over: Partial<ExecResult>): ExecResult {
  return { stdout: "", stderr: "", exitCode: 0, error: null, launched: true, ...over };
}

/** Never launched: exitCode 1, empty output, and `launched: false`. */
function neverLaunched(): ExecResult {
  return execResult({ exitCode: 1, error: new Error("spawn sh ENOENT"), launched: false });
}

describe("runDependencyAudit — ran vs could-not-run", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-dep-audit-"));
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("../../../src/process/exec.js");
    vi.resetModules();
    await rm(projectDir, { recursive: true, force: true });
  });

  /**
   * Load runDependencyAudit with execShellCmd stubbed per command. The audit
   * makes two invocations and they fail independently, so the stub dispatches on
   * the command string rather than call order.
   */
  async function withExecResults(byCommand: {
    audit: ExecResult | (() => never);
    outdated: ExecResult | (() => never);
  }) {
    vi.doMock("../../../src/process/exec.js", () => ({
      execShellCmd: async (command: string) => {
        const entry = command.includes("outdated") ? byCommand.outdated : byCommand.audit;
        if (typeof entry === "function") entry();
        return entry;
      },
    }));
    return (await import("../../../src/tools/test-runner.js")).runDependencyAudit;
  }

  it("does not report a clean audit when neither command could be launched", async () => {
    const runDependencyAudit = await withExecResults({
      audit: neverLaunched(),
      outdated: neverLaunched(),
    });

    const result = await runDependencyAudit({ projectDir });

    // The crux. `ran: true` here is what let the caller print
    // "✓ No vulnerabilities or outdated packages found" for an audit that never
    // executed a single command.
    expect(result.ran).toBe(false);

    // Not a deliberate skip — that would read as "nothing was wrong".
    expect(result.skipped).toBe(false);
    expect(result.skipReason).toBeUndefined();

    // The reason must name the underlying spawn failure so an operator can act.
    expect(result.error).toContain("could not be executed");
    expect(result.error).toContain("spawn sh ENOENT");

    // Per-step records say which command failed and why, rather than the bare
    // `exitCode: 1` the old shape carried.
    expect(result.commands?.audit?.ran).toBe(false);
    expect(result.commands?.outdated?.ran).toBe(false);
    expect(result.commands?.audit?.error).toContain("pnpm audit --json");
    expect(result.commands?.outdated?.error).toContain("pnpm outdated --json");

    // The counts are still zero — they have to be, nothing was measured. What
    // changed is that `ran`/`error` now stop them being read as findings.
    expect(result.vulnerabilities.critical).toBe(0);
    expect(result.outdated.major).toEqual([]);
  });

  it("still reports a genuine clean audit as clean", async () => {
    const runDependencyAudit = await withExecResults({
      audit: execResult({ stdout: CLEAN_AUDIT_JSON, exitCode: 0 }),
      // `pnpm outdated --json` prints nothing and exits 0 when every dependency
      // is current. That is a real empty report, not a failure to report.
      outdated: execResult({ stdout: "", exitCode: 0 }),
    });

    const result = await runDependencyAudit({ projectDir });

    // Regression guard for the fix above: the fail-closed direction must not
    // swallow the happy path.
    expect(result.ran).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.commands?.audit?.ran).toBe(true);
    expect(result.commands?.outdated?.ran).toBe(true);
    expect(result.vulnerabilities).toMatchObject({ critical: 0, high: 0, moderate: 0, low: 0 });
    expect(result.outdated).toEqual({ major: [], minor: [], patch: [] });
    expect(result.perPackage).toEqual([]);
  });

  it("reports findings from a launched audit", async () => {
    const runDependencyAudit = await withExecResults({
      // pnpm audit exits non-zero when it finds something; the payload is still
      // on stdout and is still a real result.
      audit: execResult({ stdout: DIRTY_AUDIT_JSON, exitCode: 1 }),
      outdated: execResult({
        stdout: JSON.stringify({ vitest: { current: "4.0.0", latest: "5.1.0" } }),
        exitCode: 1,
      }),
    });

    const result = await runDependencyAudit({ projectDir });

    expect(result.ran).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.vulnerabilities.high).toBe(1);
    expect(result.vulnerabilities.packages).toEqual([
      { name: "left-pad", version: "1.0.0", severity: "high" },
    ]);
    expect(result.outdated.major).toEqual(["vitest"]);
    expect(result.perPackage).toEqual(
      expect.arrayContaining([
        { name: "left-pad", vulnerabilityCount: 1, outdatedCount: 0 },
        { name: "vitest", vulnerabilityCount: 0, outdatedCount: 1 },
      ]),
    );
  });

  it("marks a partial audit rather than reporting the failed half as clean", async () => {
    const runDependencyAudit = await withExecResults({
      audit: neverLaunched(),
      outdated: execResult({ stdout: "{}", exitCode: 0 }),
    });

    const result = await runDependencyAudit({ projectDir });

    // One step reported, so the audit did produce something: `ran` is true. But
    // the vulnerability counts came from nowhere, and `error` is what says so.
    expect(result.ran).toBe(true);
    expect(result.error).toContain("partial");
    expect(result.error).toContain("pnpm audit --json");
    expect(result.commands?.audit?.ran).toBe(false);
    expect(result.commands?.outdated?.ran).toBe(true);
  });

  it("treats a non-zero exit with no output as inconclusive, not as no findings", async () => {
    const runDependencyAudit = await withExecResults({
      // What a missing lockfile looks like: nothing on stdout, the reason on
      // stderr, non-zero exit. The old `stdout` guard skipped the parse and
      // returned zeros.
      audit: execResult({ stderr: "ERR_PNPM_NO_LOCKFILE  No lockfile found", exitCode: 1 }),
      outdated: execResult({ stderr: "ERR_PNPM_NO_LOCKFILE  No lockfile found", exitCode: 1 }),
    });

    const result = await runDependencyAudit({ projectDir });

    expect(result.ran).toBe(false);
    expect(result.error).toContain("exited 1 with no output");
    // The stderr tail is carried through, because it is the only thing that
    // tells the operator what to fix.
    expect(result.error).toContain("ERR_PNPM_NO_LOCKFILE");
  });

  it("treats unparseable output as inconclusive, not as no findings", async () => {
    const runDependencyAudit = await withExecResults({
      audit: execResult({ stdout: "not json at all", exitCode: 0 }),
      // Parses, but carries no vulnerability data. pnpm reports its own errors
      // as JSON too, and reading one as zero vulnerabilities is the same defect
      // wearing a different hat.
      outdated: execResult({ stdout: "[]", exitCode: 0 }),
    });

    const result = await runDependencyAudit({ projectDir });

    expect(result.ran).toBe(false);
    expect(result.commands?.audit?.error).toContain("could not be parsed");
    expect(result.commands?.outdated?.error).toContain("could not be parsed");
  });

  it("records a throw from exec instead of discarding it", async () => {
    const runDependencyAudit = await withExecResults({
      audit: () => {
        throw new Error("exec contract violated");
      },
      outdated: () => {
        throw new Error("exec contract violated");
      },
    });

    const result = await runDependencyAudit({ projectDir });

    // The bare `catch {}` this replaces hid the throw AND returned a clean
    // audit. Both halves matter: the reason is kept, and `ran` is false.
    expect(result.ran).toBe(false);
    expect(result.error).toContain("exec contract violated");
  });

  it("reports a timed-out command as inconclusive", async () => {
    const runDependencyAudit = await withExecResults({
      // exitCode null is how ExecResult reports a kill.
      audit: execResult({ exitCode: null, error: new Error("timed out") }),
      outdated: execResult({ exitCode: null, error: new Error("timed out") }),
    });

    const result = await runDependencyAudit({ projectDir, timeout: 1234 });

    expect(result.ran).toBe(false);
    expect(result.error).toContain("did not finish");
    expect(result.error).toContain("1234ms");
  });
});
