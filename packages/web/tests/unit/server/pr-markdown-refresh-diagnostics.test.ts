import { describe, it, expect } from "vitest";
import {
  buildPRMarkdownRefreshFailure,
  classifyPRMarkdownRefreshFailureCode,
  classifyPRMarkdownRefreshPreflightCode,
  GIT_CREDENTIAL_HELPER_COMMAND,
  getPRMarkdownRefreshRemediationHints,
  resolvePRMarkdownRefreshPreflightErrorContract,
  resolvePRMarkdownRefreshGuidance,
  shouldUsePRMarkdownFallback,
  shouldUsePRMarkdownFallbackForCode,
  validatePRMarkdownRefreshPreflightErrorContract,
} from "../../../src/server/pr-markdown-refresh-diagnostics.js";

describe("classifyPRMarkdownRefreshFailureCode", () => {
  it.each([
    ["Error: Git is not available on PATH.", "missing_git"],
    ["fatal: not a git repository (or any of the parent directories): .git", "not_repo"],
    ["DETACHED_HEAD: HEAD is detached at commit 1234567890abcdef1234567890abcdef12345678.", "rev_parse_failed"],
    ["Error: Could not resolve a base branch (`main` or `origin/main`).", "unresolved_main_or_origin_main"],
    ["FETCH_DENIED: Remote 'origin' rejected authentication/authorization for 'main'.", "auth_fetch_denied"],
    ["fatal: Authentication failed for 'https://example.invalid/repo.git/'", "auth_fetch_denied"],
    ["NETWORK_DNS_ERROR: Could not reach remote 'origin' while checking 'main'.", "network_dns_error"],
    ["fatal: unable to access 'https://example.invalid/repo.git/': Could not resolve host: example.invalid", "network_dns_error"],
    ["Error: Failed to fetch origin/main from remote.", "fetch_failed"],
    ["fatal: couldn't find remote ref main", "fetch_failed"],
    ["Error: git rev-parse failed while resolving origin/main.", "rev_parse_failed"],
    ["Error: Failed to compute git diff for 'main...HEAD'.", "diff_failed"],
    ["fatal: bad revision 'main...HEAD'", "diff_failed"],
    ["fatal: ambiguous argument 'main...HEAD': unknown revision or path not in the working tree.", "diff_failed"],
  ])("classifies %s", (details, expected) => {
    expect(classifyPRMarkdownRefreshFailureCode(details)).toBe(expected);
  });

  it("returns null for unknown failures", () => {
    expect(classifyPRMarkdownRefreshFailureCode("unexpected failure")).toBeNull();
  });

  it.each([
    "missing_git",
    "not_repo",
    "unresolved_main_or_origin_main",
    "auth_fetch_denied",
    "network_dns_error",
    "fetch_failed",
    "rev_parse_failed",
    "diff_failed",
  ] as const)("returns at least one remediation hint for %s", (code) => {
    const hints = getPRMarkdownRefreshRemediationHints(code);
    expect(Array.isArray(hints)).toBe(true);
    expect(hints.length).toBeGreaterThan(0);
  });

  it("includes explicit main and origin/main guidance for unresolved base branch", () => {
    const hints = getPRMarkdownRefreshRemediationHints("unresolved_main_or_origin_main");
    expect(hints.join("\n")).toContain("main");
    expect(hints.join("\n")).toContain("origin/main");
  });

  it("includes the exact credential helper command for auth failures only", () => {
    const authHints = getPRMarkdownRefreshRemediationHints("auth_fetch_denied").join("\n");
    expect(authHints).toContain(GIT_CREDENTIAL_HELPER_COMMAND);

    const nonAuthHints = getPRMarkdownRefreshRemediationHints("fetch_failed").join("\n");
    expect(nonAuthHints).not.toContain(GIT_CREDENTIAL_HELPER_COMMAND);
  });

  it.each([
    ["NOT_A_REPO: This directory is not a git repository.", "not_repo"],
    ["FETCH_DENIED: Remote 'origin' rejected authentication/authorization for 'main'.", "auth_fetch_denied"],
    ["Error: Failed to compute git diff for 'main...HEAD'.", "diff_failed"],
  ])("marks %s as fallback-triggering (%s)", (details, code) => {
    expect(classifyPRMarkdownRefreshFailureCode(details)).toBe(code);
    expect(shouldUsePRMarkdownFallback(details)).toBe(true);
  });

  it.each([
    "missing_git",
    "not_repo",
    "unresolved_main_or_origin_main",
    "auth_fetch_denied",
    "network_dns_error",
    "fetch_failed",
    "rev_parse_failed",
    "diff_failed",
  ] as const)("flags %s as fallback-triggering code", (code) => {
    expect(shouldUsePRMarkdownFallbackForCode(code)).toBe(true);
  });

  it("does not trigger fallback for non-git internal errors", () => {
    const nonGitInternal = "TypeError: Cannot read properties of undefined (reading 'map')";
    expect(classifyPRMarkdownRefreshFailureCode(nonGitInternal)).toBeNull();
    expect(shouldUsePRMarkdownFallback(nonGitInternal)).toBe(false);
  });

  it("builds semantic-diff failure payload with command context", () => {
    const failure = buildPRMarkdownRefreshFailure(
      "diff_failed",
      "Error: Failed to inspect semantic diff details for 'main...HEAD'.",
      {
        semanticDiffInspection: true,
        nameStatusDiffSucceeded: true,
        commandExecution: {
          stderr: "fatal: unable to access 'https://user:ghp_SUPERSECRET123@example.invalid/repo.git/'",
          exitCode: 1,
        },
      },
    );
    expect(failure.type).toBe("pr_markdown_refresh_failure");
    expect(failure.stage).toBe("mixed");
    expect(failure.stageStatuses?.nameStatusDiff).toBe("succeeded");
    expect(failure.stageStatuses?.semanticDiff).toBe("failed");
    expect(typeof failure.summary).toBe("string");
    expect(failure.remediationCommands.length).toBeGreaterThan(0);
    expect(failure.guidanceCategory).toBe("local_history_remediation");
    expect(failure.commandSuggestions).toContain("git diff main...HEAD --name-status");
    expect(failure.command.gitSubcommand).toBe("diff");
    expect(failure.command.stageId).toBe("semantic_diff_numstat");
    expect(failure.command.subcommand).toBe("git --no-pager diff --no-ext-diff --no-textconv --numstat main...HEAD");
    expect(failure.command.exitCode).toBe(1);
    expect(failure.command.stderr).toContain("https://user:***@example.invalid/repo.git/");
    expect(failure.command.stderr).not.toContain("ghp_SUPERSECRET123");
    expect(failure.command.stderrExcerpt).toContain("https://user:***@example.invalid/repo.git/");
    expect(failure.command.reproduce).toContain("git diff main...HEAD --name-status");
  });

  it("resolves fetch retry guidance for fetch-related failures", () => {
    const guidance = resolvePRMarkdownRefreshGuidance("fetch_failed");
    expect(guidance.category).toBe("fetch_retry");
    expect(guidance.commands).toContain("git fetch origin main");
  });

  it("resolves local-history guidance for rev-parse/diff failures", () => {
    const guidance = resolvePRMarkdownRefreshGuidance("rev_parse_failed");
    expect(guidance.category).toBe("local_history_remediation");
    expect(guidance.commands).toContain("git rev-parse --verify main");
  });

  it.each([
    ["Error: This directory is not a git repository.", "NOT_A_REPO"],
    ["Error: Could not resolve a base branch (`main` or `origin/main`).", "MISSING_BASE_REF"],
    ["FETCH_DENIED: Remote 'origin' rejected authentication/authorization for 'main'.", "FETCH_DENIED"],
    ["NETWORK_DNS_ERROR: Could not reach remote 'origin' while checking 'main'.", "NETWORK_DNS_ERROR"],
    ["DETACHED_HEAD: HEAD is detached at commit 1234567.", "DETACHED_HEAD"],
    ["fatal: shallow update not allowed", "SHALLOW_CLONE"],
  ])("classifies stable preflight code %s", (details, expected) => {
    const diagnosticCode = classifyPRMarkdownRefreshFailureCode(details);
    expect(classifyPRMarkdownRefreshPreflightCode(details, diagnosticCode)).toBe(expected);
  });

  it.each([
    "NOT_A_REPO",
    "MISSING_BASE_REF",
    "FETCH_DENIED",
    "NETWORK_DNS_ERROR",
    "DETACHED_HEAD",
    "SHALLOW_CLONE",
  ] as const)("provides contract summary and remediation commands for %s", (expectedCode) => {
    const fixtureByCode: Record<string, string> = {
      NOT_A_REPO: "Error: This directory is not a git repository.",
      MISSING_BASE_REF: "Error: Could not resolve a base branch (`main` or `origin/main`).",
      FETCH_DENIED: "FETCH_DENIED: Remote 'origin' rejected authentication/authorization for 'main'.",
      NETWORK_DNS_ERROR: "NETWORK_DNS_ERROR: Could not reach remote 'origin' while checking 'main'.",
      DETACHED_HEAD: "DETACHED_HEAD: HEAD is detached at commit 1234567.",
      SHALLOW_CLONE: "fatal: shallow update not allowed",
    };
    const fixture = fixtureByCode[expectedCode];
    const contract = resolvePRMarkdownRefreshPreflightErrorContract(
      fixture,
      classifyPRMarkdownRefreshFailureCode(fixture),
    );
    expect(contract?.code).toBe(expectedCode);
    expect(contract?.summary?.length ?? 0).toBeGreaterThan(0);
    expect(contract?.remediationCommands?.length ?? 0).toBeGreaterThan(0);
  });

  it("fails schema validation when remediationCommands is missing for preflight contract", () => {
    expect(validatePRMarkdownRefreshPreflightErrorContract({
      code: "NOT_A_REPO",
      summary: "Not a repository",
    })).toBe(false);
  });

  it("adds stable code/summary/remediationCommands on preflight failure payload", () => {
    const failure = buildPRMarkdownRefreshFailure(
      "not_repo",
      "Error: This directory is not a git repository.",
      { semanticDiffInspection: false, nameStatusDiffSucceeded: false },
    );
    expect(failure.stage).toBe("preflight");
    expect(failure.code).toBe("NOT_A_REPO");
    expect(failure.summary.length).toBeGreaterThan(0);
    expect(failure.remediationCommands.length).toBeGreaterThan(0);
  });
});
