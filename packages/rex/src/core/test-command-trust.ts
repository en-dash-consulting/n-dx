import { evaluateRepoTrust, type RepoTrustState } from "@n-dx/llm-client";

/** Why a requested test run was refused, in the shape `verify_criteria` returns. */
export interface TestRunRefusal {
  testsSkipped: string;
  trust: { state: RepoTrustState; findings: string[] };
}

export interface TestCommandGate {
  /** The repository's test command, when it is a string. */
  testCommand: string | undefined;
  /** Whether the caller may run tests. */
  runTests: boolean;
  /** Set when tests were requested but refused. */
  refusal?: TestRunRefusal;
}

export const TESTS_SKIPPED_UNTRUSTED =
  "The repository's execution config is not trusted, so its test command was not run. Review with `ndx trust .` and accept with `ndx trust accept .`.";

/**
 * Decide whether the repository's test command may run (#686 finding 2).
 *
 * The command comes from the repository (`.rex/config.json`, or `rex.test` in
 * `.n-dx.json`), so it runs only once the user has accepted this exact
 * execution config with `ndx trust accept .`. `!restricted` is not enough: a
 * plain command is an info finding, leaving the checkout `baseline` and
 * unrestricted without anyone having agreed to run it.
 *
 * Only a string is a command. The `.n-dx.json` override is merged after
 * validation, so `test` can arrive as anything; the digest records only a
 * string, and a non-string stringified into a command line would run without
 * ever having been accepted.
 *
 * Shared by `verify_criteria` and `rex verify`, so both surfaces apply one rule.
 */
export function gateRepoTestCommand(projectDir: string, configTest: unknown, requested: boolean): TestCommandGate {
  const testCommand = typeof configTest === "string" ? configTest : undefined;
  if (!requested) return { testCommand, runTests: false };
  const trust = evaluateRepoTrust(projectDir);
  const accepted = trust.record != null && trust.record.digest === trust.config.digest;
  if (!testCommand || accepted) return { testCommand, runTests: true };
  return {
    testCommand,
    runTests: false,
    refusal: {
      testsSkipped: TESTS_SKIPPED_UNTRUSTED,
      trust: {
        state: trust.state,
        findings: trust.findings.filter((f) => f.severity === "warning").map((f) => f.message),
      },
    },
  };
}
