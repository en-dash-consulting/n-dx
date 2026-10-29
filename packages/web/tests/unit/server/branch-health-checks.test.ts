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

describe("failedTestFiles", () => {
  it("collects vitest FAIL lines once each", () => {
    expect(failedTestFiles(" FAIL  a.test.ts > x\n FAIL  a.test.ts > y\n × ./b.spec.tsx\n")).toEqual(["a.test.ts", "b.spec.tsx"]);
  });
});
