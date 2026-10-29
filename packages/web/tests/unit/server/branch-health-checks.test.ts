/**
 * Failing-check classes, one case per class, from fixture gh output: a
 * `statusCheckRollup` entry as `gh pr view --json` prints it, and the text
 * `gh run view --log-failed` prints for it.
 *
 * @see packages/web/src/server/branch-health/checks.ts
 */

import { describe, it, expect } from "vitest";
import {
  capLogTail,
  classifyFailingCheck,
  cleanLog,
  failedTestFiles,
  parseRollup,
  LOG_TAIL_MAX_CHARS,
  LOG_TAIL_MAX_LINES,
} from "../../../src/server/branch-health/index.js";
import type { CheckFailureClass } from "../../../src/server/branch-health/index.js";

interface Fixture {
  rollup: Record<string, unknown>;
  log: string | null;
  isCrossRepository?: boolean;
  changedFiles?: string[];
}

function classify(fixture: Fixture): { class: CheckFailureClass; evidence: string } {
  const [check] = parseRollup([fixture.rollup]);
  return classifyFailingCheck({
    name: check.name,
    outcome: check.outcome,
    log: fixture.log,
    isCrossRepository: fixture.isCrossRepository ?? false,
    changedFiles: fixture.changedFiles ?? [],
  });
}

const checkRun = (name: string, conclusion = "FAILURE") => ({
  __typename: "CheckRun",
  name,
  status: "COMPLETED",
  conclusion,
  detailsUrl: "https://github.com/acme/repo/actions/runs/9/job/10",
});

describe("classifyFailingCheck", () => {
  it("behind-base: the log says the branch is out of date with its base", () => {
    const verdict = classify({
      rollup: checkRun("merge-gate"),
      log: "merge-gate\tCheck\t##[error]This branch is out of date with the base branch. Merge or rebase main.\n",
    });
    expect(verdict.class).toBe("behind-base");
  });

  it("policy-test: the log names a policy suite", () => {
    const verdict = classify({
      rollup: checkRun("test (ubuntu-latest)"),
      log: [
        "test (ubuntu-latest)\tRun tests\t FAIL  tests/e2e/architecture-policy.test.js > spawn-only orchestration",
        "test (ubuntu-latest)\tRun tests\tAssertionError: packages/core/x.js imports @n-dx/rex",
      ].join("\n"),
      changedFiles: ["packages/core/x.js"],
    });
    expect(verdict).toMatchObject({ class: "policy-test" });
    expect(verdict.evidence).toContain("architecture-policy.test.js");
  });

  it("codeql: a CodeQL check, whatever its log says", () => {
    const verdict = classify({
      rollup: checkRun("CodeQL / Analyze (javascript)"),
      log: "Analyze\tPerform CodeQL Analysis\t##[error]2 new alerts\n",
    });
    expect(verdict.class).toBe("codeql");
  });

  it("codeql: a code-scanning StatusContext with no Actions log", () => {
    const verdict = classify({
      rollup: { __typename: "StatusContext", context: "Code scanning results / CodeQL", state: "FAILURE", targetUrl: "https://github.com/acme/repo/security" },
      log: null,
    });
    expect(verdict.class).toBe("codeql");
  });

  it("touched-test: the log names a failing test file this branch changed, by package-relative path", () => {
    const verdict = classify({
      rollup: checkRun("test (macos-latest)"),
      log: [
        "test (macos-latest)\tRun tests\t ❯ tests/unit/viewer/workspaces-view.test.ts (40 tests | 1 failed)",
        "test (macos-latest)\tRun tests\t FAIL  tests/unit/viewer/workspaces-view.test.ts > WorkspacesView > renders",
      ].join("\n"),
      changedFiles: ["packages/web/src/viewer/views/workspaces.ts", "packages/web/tests/unit/viewer/workspaces-view.test.ts"],
    });
    expect(verdict).toMatchObject({ class: "touched-test" });
    expect(verdict.evidence).toContain("packages/web/tests/unit/viewer/workspaces-view.test.ts");
  });

  it("fork-no-ci: a fork's check waiting for workflow approval", () => {
    const verdict = classify({
      rollup: checkRun("test (ubuntu-latest)", "ACTION_REQUIRED"),
      log: null,
      isCrossRepository: true,
    });
    expect(verdict.class).toBe("fork-no-ci");
  });

  it("unclassified: a failing test the branch did not touch", () => {
    const verdict = classify({
      rollup: checkRun("test (windows-latest)"),
      log: "test (windows-latest)\tRun tests\t FAIL  tests/unit/other.test.ts > flaky timing\n",
      changedFiles: ["packages/web/src/server/routes-git.ts"],
    });
    expect(verdict.class).toBe("unclassified");
  });
});

describe("parseRollup", () => {
  it("normalises CheckRun and StatusContext entries and reads Actions ids from the URL", () => {
    expect(parseRollup([
      checkRun("lint", "SUCCESS"),
      { __typename: "StatusContext", context: "deploy", state: "ERROR", targetUrl: "" },
      "not an object",
    ])).toEqual([
      { name: "lint", outcome: "SUCCESS", url: "https://github.com/acme/repo/actions/runs/9/job/10", runId: "9", jobId: "10" },
      { name: "deploy", outcome: "ERROR", url: null, runId: null, jobId: null },
    ]);
  });
});

describe("capLogTail", () => {
  it("keeps the last 80 lines", () => {
    const log = Array.from({ length: 10_000 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const tail = capLogTail(log).split("\n");
    expect(tail).toHaveLength(LOG_TAIL_MAX_LINES);
    expect(tail[0]).toBe("line 9921");
    expect(tail.at(-1)).toBe("line 10000");
  });

  it("then keeps the last 8,000 characters when 80 lines are longer", () => {
    const log = Array.from({ length: 10_000 }, (_, i) => `${i + 1} ${"y".repeat(500)}`).join("\n");
    const tail = capLogTail(log);
    expect(tail).toHaveLength(LOG_TAIL_MAX_CHARS);
    expect(tail.endsWith(`10000 ${"y".repeat(500)}`)).toBe(true);
  });
});

describe("coloured CI logs", () => {
  it("strips colour codes so a coloured FAIL line still classes as touched-test", () => {
    const esc = String.fromCharCode(0x1b);
    const raw = `test\tRun tests\t ${esc}[31m${esc}[1mFAIL${esc}[22m${esc}[39m ${esc}[2mtests/unit/${esc}[22ma.test.ts > a > b\n`;
    const tail = capLogTail(raw);
    expect(tail).not.toContain(esc);
    const verdict = classifyFailingCheck({
      name: "test", outcome: "FAILURE", log: tail, isCrossRepository: false,
      changedFiles: ["packages/web/tests/unit/a.test.ts"],
    });
    expect(verdict.class).toBe("touched-test");
  });
});

describe("behind-base from the PR and the stack", () => {
  // PR #907: one Windows check failing in a test the branch never touched,
  // while the PR was BEHIND and lower stack layers held the fix.
  const base = {
    name: "Tests (Windows, root+llm-client)",
    outcome: "FAILURE",
    log: "packages/llm-client test:  FAIL  tests/integration/vendor-session.test.ts > vendor session\n",
    isCrossRepository: false,
    changedFiles: ["packages/web/src/server/routes-git.ts"],
  };

  it("names the merge state when the PR is BEHIND", () => {
    const verdict = classifyFailingCheck({ ...base, mergeStateStatus: "BEHIND", stack: [] });
    expect(verdict.class).toBe("behind-base");
    expect(verdict.evidence).toContain("BEHIND");
  });

  it("names the uncontained layer when the stack lacks one", () => {
    const verdict = classifyFailingCheck({
      ...base,
      mergeStateStatus: "BLOCKED",
      stack: [{ branch: "feat/sidecar-m3-lenses", contained: true }, { branch: "feat/sidecar-m2-drawer", contained: false }],
    });
    expect(verdict.class).toBe("behind-base");
    expect(verdict.evidence).toContain("feat/sidecar-m2-drawer");
    expect(verdict.evidence).not.toContain("feat/sidecar-m3-lenses");
  });

  it("stays unclassified when the PR is up to date and every layer is contained", () => {
    const verdict = classifyFailingCheck({
      ...base,
      mergeStateStatus: "BLOCKED",
      stack: [{ branch: "feat/sidecar-m3-lenses", contained: true }],
    });
    expect(verdict.class).toBe("unclassified");
  });
});

describe("whole-log classification", () => {
  const PREFIX = "Tests (Windows)\tRun tests\t2026-10-29T12:34:56.1234567Z ";

  it("classes touched-test when the failing file appears above the last 80 lines", () => {
    const log = [
      `${PREFIX}packages/llm-client test:  FAIL  tests/integration/vendor-session.test.ts > vendor session`,
      ...Array.from({ length: 500 }, (_, i) => `${PREFIX}stack frame ${i}`),
    ].join("\n");
    expect(capLogTail(log)).not.toContain("vendor-session.test.ts");
    const verdict = classifyFailingCheck({
      name: "Tests (Windows)", outcome: "FAILURE", log, isCrossRepository: false,
      changedFiles: ["packages/llm-client/tests/integration/vendor-session.test.ts"],
    });
    expect(verdict.class).toBe("touched-test");
  });

  it("matches a package-relative path only against the package the log names", () => {
    const log = "packages/llm-client test:  FAIL  tests/x.test.ts > a\n";
    const classify = (changedFiles: string[]) => classifyFailingCheck({
      name: "test", outcome: "FAILURE", log, isCrossRepository: false, changedFiles,
    }).class;
    expect(classify(["packages/llm-client/tests/x.test.ts"])).toBe("touched-test");
    expect(classify(["packages/rex/tests/x.test.ts"])).toBe("unclassified");
  });

  it("drops gh's job, step and timestamp prefix from every line of the tail", () => {
    const log = Array.from({ length: 200 }, (_, i) => `${PREFIX}line ${i + 1}`).join("\n");
    const tail = capLogTail(log).split("\n");
    expect(tail).toHaveLength(LOG_TAIL_MAX_LINES);
    expect(tail.every((line) => /^line \d+$/.test(line))).toBe(true);
    expect(cleanLog(log)).not.toMatch(/\t|2026-10-29T/);
  });
});

describe("failedTestFiles", () => {
  it("collects vitest FAIL lines once each", () => {
    expect(failedTestFiles(" FAIL  a.test.ts > x\n FAIL  a.test.ts > y\n × ./b.spec.tsx\n")).toEqual(["a.test.ts", "b.spec.tsx"]);
  });
});
