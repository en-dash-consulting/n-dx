export type PRMarkdownRefreshDiagnosticCode =
  | "missing_git"
  | "not_repo"
  | "unresolved_main_or_origin_main"
  | "auth_fetch_denied"
  | "network_dns_error"
  | "fetch_failed"
  | "rev_parse_failed"
  | "diff_failed";

export type PRMarkdownRefreshPreflightFailureCode =
  | "NOT_A_REPO"
  | "MISSING_BASE_REF"
  | "FETCH_DENIED"
  | "NETWORK_DNS_ERROR"
  | "DETACHED_HEAD"
  | "SHALLOW_CLONE";

export type PRMarkdownRefreshFailureCode =
  | PRMarkdownRefreshDiagnosticCode
  | PRMarkdownRefreshPreflightFailureCode;

export type PRMarkdownRefreshFailureStage =
  | "preflight"
  | "fetch"
  | "rev-parse"
  | "diff"
  | "semantic-diff"
  | "mixed";

export type PRMarkdownRefreshDiffStageStatus = "succeeded" | "failed" | "not_run";

export type PRMarkdownRefreshGuidanceCategory =
  | "environment_fix"
  | "fetch_retry"
  | "local_history_remediation";

export type PRMarkdownRefreshGitSubcommand =
  | "version"
  | "rev-parse"
  | "fetch"
  | "diff";

export type PRMarkdownRefreshFailureCommandStageId =
  | "preflight"
  | "fetch"
  | "rev_parse"
  | "name_status_diff"
  | "semantic_diff_numstat";

export interface PRMarkdownRefreshFailureCommandExecution {
  stderr?: string;
  exitCode?: number | null;
}

export interface PRMarkdownRefreshGuidance {
  category: PRMarkdownRefreshGuidanceCategory;
  summary: string;
  commands: string[];
}

export interface PRMarkdownRefreshFailure {
  type: "pr_markdown_refresh_failure";
  code: PRMarkdownRefreshFailureCode;
  stage: PRMarkdownRefreshFailureStage;
  stageStatuses?: {
    nameStatusDiff: PRMarkdownRefreshDiffStageStatus;
    semanticDiff: PRMarkdownRefreshDiffStageStatus;
  };
  summary: string;
  remediationCommands: string[];
  guidanceCategory: PRMarkdownRefreshGuidanceCategory;
  commandSuggestions: string[];
  command: {
    gitSubcommand: PRMarkdownRefreshGitSubcommand;
    subcommand?: string;
    stageId?: PRMarkdownRefreshFailureCommandStageId;
    stderr?: string;
    exitCode?: number | null;
    stderrExcerpt: string;
    reproduce: string[];
  };
}

export const GIT_CREDENTIAL_HELPER_COMMAND = "sourcevision git-credential-helper";

const FALLBACK_TRIGGER_CODES = new Set<PRMarkdownRefreshDiagnosticCode>([
  "missing_git",
  "not_repo",
  "unresolved_main_or_origin_main",
  "auth_fetch_denied",
  "network_dns_error",
  "fetch_failed",
  "rev_parse_failed",
  "diff_failed",
]);

const REMEDIATION_HINTS: Record<PRMarkdownRefreshDiagnosticCode, string[]> = {
  missing_git: [
    "Install Git and ensure `git` is available on PATH, then retry refresh.",
  ],
  not_repo: [
    "Run refresh from a cloned Git repository (a directory containing `.git`).",
  ],
  unresolved_main_or_origin_main: [
    "Check that `main` or `origin/main` exists (`git rev-parse --verify main` and `git rev-parse --verify origin/main`), then fetch or create one before retrying.",
  ],
  auth_fetch_denied: [
    `Run \`${GIT_CREDENTIAL_HELPER_COMMAND}\` to set up git credentials, then retry refresh.`,
  ],
  network_dns_error: [
    "Remote host could not be reached. Verify DNS/network/VPN/proxy connectivity to your git remote and retry refresh.",
  ],
  fetch_failed: [
    "Run `git fetch origin main` manually and verify remote connectivity.",
  ],
  rev_parse_failed: [
    "Verify the base ref resolves (`git rev-parse --verify main` or `git rev-parse --verify origin/main`) and retry refresh.",
  ],
  diff_failed: [
    "Run `git diff main...HEAD --name-status` (or `origin/main...HEAD`) to reproduce and fix the diff error, then retry refresh.",
  ],
};

const FETCH_ERROR_TOKENS = [
  "fetch_denied",
  "authentication failed",
  "authorization failed",
  "access denied",
  "could not read username",
  "terminal prompts disabled",
  "http basic: access denied",
  "the requested url returned error: 401",
  "the requested url returned error: 403",
];

const NETWORK_ERROR_TOKENS = [
  "network_dns_error",
  "could not resolve host",
  "name or service not known",
  "temporary failure in name resolution",
  "failed to connect to",
  "connection timed out",
  "network is unreachable",
  "no route to host",
  "connection refused",
];

const LOCAL_HISTORY_ERROR_TOKENS = [
  "bad revision",
  "unknown revision or path not in the working tree",
  "invalid symmetric difference expression",
  "fatal: ambiguous argument",
  "no merge base",
  "not something we can merge",
];

const SHALLOW_CLONE_ERROR_TOKENS = [
  "shallow clone",
  "shallow repository",
  "is shallow",
  "--unshallow",
  "git fetch --depth",
  "shallow update not allowed",
];

interface PRMarkdownRefreshPreflightErrorContract {
  code: PRMarkdownRefreshPreflightFailureCode;
  summary: string;
  remediationCommands: string[];
}

const PREFLIGHT_ERROR_CATALOG: Record<PRMarkdownRefreshPreflightFailureCode, Omit<PRMarkdownRefreshPreflightErrorContract, "code">> = {
  NOT_A_REPO: {
    summary: "The refresh command is running outside a Git repository.",
    remediationCommands: [
      "git rev-parse --is-inside-work-tree",
      "cd <repository-root>",
      "sourcevision pr-markdown <project-dir>",
    ],
  },
  MISSING_BASE_REF: {
    summary: "Neither `main` nor `origin/main` could be resolved for diff preflight.",
    remediationCommands: [
      "git rev-parse --verify main",
      "git rev-parse --verify origin/main",
      "git fetch origin main",
    ],
  },
  FETCH_DENIED: {
    summary: "Remote fetch was denied due to missing/invalid credentials.",
    remediationCommands: [
      GIT_CREDENTIAL_HELPER_COMMAND,
      "git fetch origin main",
    ],
  },
  NETWORK_DNS_ERROR: {
    summary: "Remote host could not be resolved or reached over the network.",
    remediationCommands: [
      "git remote -v",
      "git fetch origin main",
    ],
  },
  DETACHED_HEAD: {
    summary: "HEAD is detached, so PR diff preflight cannot infer branch context.",
    remediationCommands: [
      "git status --short --branch",
      "git switch -c <branch-name>",
      "git rev-parse --abbrev-ref HEAD",
    ],
  },
  SHALLOW_CLONE: {
    summary: "Repository history is shallow and does not contain enough commits for base diffing.",
    remediationCommands: [
      "git rev-parse --is-shallow-repository",
      "git fetch --unshallow",
      "git fetch origin main --depth=200",
    ],
  },
};

function getErrorText(input: unknown): string {
  if (typeof input === "string") return input;
  if (!(input instanceof Error)) return "";
  const err = input as NodeJS.ErrnoException & { stderr?: string | Buffer };
  const stderrRaw = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf-8") ?? "";
  return `${stderrRaw}\n${err.message ?? ""}`.trim();
}

function normalizeText(input: unknown): string {
  return getErrorText(input).toLowerCase();
}

export function classifyPRMarkdownRefreshFailureCode(input: unknown): PRMarkdownRefreshDiagnosticCode | null {
  const normalized = normalizeText(input);
  if (!normalized) return null;

  if (
    normalized.includes("git is not available on path")
    || (normalized.includes("git") && normalized.includes("enoent"))
    || normalized.includes("spawn git enoent")
  ) {
    return "missing_git";
  }

  if (
    normalized.includes("not a git repository")
    || normalized.includes("outside repository")
  ) {
    return "not_repo";
  }

  if (
    normalized.includes("could not resolve a base branch")
    || normalized.includes("unresolved")
      && normalized.includes("origin/main")
  ) {
    return "unresolved_main_or_origin_main";
  }

  if (FETCH_ERROR_TOKENS.some((token) => normalized.includes(token))) {
    return "auth_fetch_denied";
  }

  if (NETWORK_ERROR_TOKENS.some((token) => normalized.includes(token))) {
    return "network_dns_error";
  }

  if (
    normalized.includes("failed to fetch")
    || normalized.includes("fetch failed")
    || normalized.includes("couldn't find remote ref")
    || normalized.includes("remote ref does not exist")
    || (normalized.includes("git fetch") && normalized.includes("failed"))
  ) {
    return "fetch_failed";
  }

  if (
    normalized.includes("detached_head")
    || normalized.includes("head is detached")
  ) {
    return "rev_parse_failed";
  }

  if (
    normalized.includes("rev-parse")
    || normalized.includes("rev parse")
  ) {
    return "rev_parse_failed";
  }

  if (
    LOCAL_HISTORY_ERROR_TOKENS.some((token) => normalized.includes(token))
    || normalized.includes("fatal: bad object")
  ) {
    return "diff_failed";
  }

  if (
    normalized.includes("failed to compute git diff")
    || normalized.includes("failed to inspect semantic diff details")
    || normalized.includes("diff failed")
    || (normalized.includes("git diff") && normalized.includes("failed"))
  ) {
    return "diff_failed";
  }

  return null;
}

export function classifyPRMarkdownRefreshPreflightCode(
  input: unknown,
  diagnosticCode?: PRMarkdownRefreshDiagnosticCode | null,
): PRMarkdownRefreshPreflightFailureCode | null {
  const normalized = normalizeText(input);
  if (!normalized) return null;

  if (SHALLOW_CLONE_ERROR_TOKENS.some((token) => normalized.includes(token))) {
    return "SHALLOW_CLONE";
  }

  if (normalized.includes("detached_head") || normalized.includes("head is detached")) {
    return "DETACHED_HEAD";
  }

  if (
    normalized.includes("not a git repository")
    || normalized.includes("outside repository")
    || diagnosticCode === "not_repo"
  ) {
    return "NOT_A_REPO";
  }

  if (
    normalized.includes("could not resolve a base branch")
    || (normalized.includes("unresolved") && normalized.includes("origin/main"))
    || diagnosticCode === "unresolved_main_or_origin_main"
  ) {
    return "MISSING_BASE_REF";
  }

  if (FETCH_ERROR_TOKENS.some((token) => normalized.includes(token)) || diagnosticCode === "auth_fetch_denied") {
    return "FETCH_DENIED";
  }

  if (NETWORK_ERROR_TOKENS.some((token) => normalized.includes(token)) || diagnosticCode === "network_dns_error") {
    return "NETWORK_DNS_ERROR";
  }

  return null;
}

export function resolvePRMarkdownRefreshPreflightErrorContract(
  input: unknown,
  diagnosticCode?: PRMarkdownRefreshDiagnosticCode | null,
): PRMarkdownRefreshPreflightErrorContract | null {
  const code = classifyPRMarkdownRefreshPreflightCode(input, diagnosticCode);
  if (!code) return null;
  const spec = PREFLIGHT_ERROR_CATALOG[code];
  return {
    code,
    summary: spec.summary,
    remediationCommands: [...spec.remediationCommands],
  };
}

export function validatePRMarkdownRefreshPreflightErrorContract(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Partial<PRMarkdownRefreshPreflightErrorContract>;
  if (typeof candidate.code !== "string") return false;
  if (!(candidate.code in PREFLIGHT_ERROR_CATALOG)) return false;
  if (typeof candidate.summary !== "string" || candidate.summary.trim().length === 0) return false;
  if (!Array.isArray(candidate.remediationCommands) || candidate.remediationCommands.length === 0) return false;
  return candidate.remediationCommands.every((command) => typeof command === "string" && command.trim().length > 0);
}

export function shouldUsePRMarkdownFallbackForCode(code: PRMarkdownRefreshDiagnosticCode): boolean {
  return FALLBACK_TRIGGER_CODES.has(code);
}

export function shouldUsePRMarkdownFallback(input: unknown): boolean {
  const code = classifyPRMarkdownRefreshFailureCode(input);
  return code ? shouldUsePRMarkdownFallbackForCode(code) : false;
}

export function getPRMarkdownRefreshRemediationHints(
  code: PRMarkdownRefreshDiagnosticCode,
): string[] {
  return REMEDIATION_HINTS[code];
}

export function resolvePRMarkdownRefreshGuidance(
  code: PRMarkdownRefreshDiagnosticCode,
): PRMarkdownRefreshGuidance {
  if (code === "auth_fetch_denied" || code === "network_dns_error" || code === "fetch_failed") {
    return {
      category: "fetch_retry",
      summary: "Remote fetch failed. Resolve connectivity/credentials, then retry refresh.",
      commands: [
        "git fetch origin main",
        "sourcevision pr-markdown <project-dir>",
      ],
    };
  }

  if (code === "rev_parse_failed" || code === "unresolved_main_or_origin_main" || code === "diff_failed") {
    return {
      category: "local_history_remediation",
      summary: "Local branch/history state is incomplete for semantic diff generation.",
      commands: [
        "git rev-parse --verify main",
        "git rev-parse --verify origin/main",
        "git diff main...HEAD --name-status",
      ],
    };
  }

  return {
    category: "environment_fix",
    summary: "Environment preflight failed before refresh could run.",
    commands: [
      "git --version",
      "sourcevision pr-markdown <project-dir>",
    ],
  };
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stderrExcerpt(details: string, maxLength: number = 240): string {
  const compact = compactWhitespace(details);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function redactSensitiveValues(input: string): string {
  return input
    .replace(/(https?:\/\/[^/\s:@]+):[^@\s/]+@/gi, "$1:***@")
    .replace(/(authorization:\s*(?:basic|bearer)\s+)[^\s]+/gi, "$1***")
    .replace(/\b(token|password|secret|api[_-]?key)\s*[:=]\s*[^\s]+/gi, "$1=***")
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{8,})\b/g, "***");
}

function sanitizeCommandStderr(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const redacted = redactSensitiveValues(trimmed);
  return redacted.length > 4000 ? `${redacted.slice(0, 3997)}...` : redacted;
}

function parseComparisonRange(details: string): string | null {
  const singleQuoteMatch = /for '([^']+\.\.\.[^']+)'/i.exec(details);
  if (singleQuoteMatch?.[1]) return singleQuoteMatch[1];
  const backtickMatch = /for `([^`]+\.\.\.[^`]+)`/i.exec(details);
  if (backtickMatch?.[1]) return backtickMatch[1];
  return null;
}

function inferDiffSubcommand(details: string, semanticDiffInspection: boolean): string {
  const range = parseComparisonRange(details) ?? "main...HEAD";
  const mode = semanticDiffInspection ? "--numstat" : "--name-status";
  return `git --no-pager diff --no-ext-diff --no-textconv ${mode} ${range}`;
}

export function buildPRMarkdownRefreshFailure(
  code: PRMarkdownRefreshDiagnosticCode,
  details: string,
  options: {
    semanticDiffInspection: boolean;
    nameStatusDiffSucceeded: boolean;
    commandExecution?: PRMarkdownRefreshFailureCommandExecution;
  },
): PRMarkdownRefreshFailure {
  const guidance = resolvePRMarkdownRefreshGuidance(code);
  const preflight = resolvePRMarkdownRefreshPreflightErrorContract(details, code);
  const commandStderr = sanitizeCommandStderr(options.commandExecution?.stderr ?? details);
  const commandExitCode = options.commandExecution?.exitCode;
  if (code === "diff_failed") {
    const semanticDiffFailed = options.semanticDiffInspection;
    const nameStatusDiffStatus: PRMarkdownRefreshDiffStageStatus =
      semanticDiffFailed
        ? options.nameStatusDiffSucceeded ? "succeeded" : "failed"
        : "failed";
    const semanticDiffStatus: PRMarkdownRefreshDiffStageStatus = semanticDiffFailed ? "failed" : "not_run";
    const stage: PRMarkdownRefreshFailureStage =
      semanticDiffFailed && nameStatusDiffStatus === "succeeded"
        ? "mixed"
        : semanticDiffFailed
          ? "semantic-diff"
          : "diff";

    return {
      type: "pr_markdown_refresh_failure",
      code,
      stage,
      stageStatuses: {
        nameStatusDiff: nameStatusDiffStatus,
        semanticDiff: semanticDiffStatus,
      },
      summary: guidance.summary,
      remediationCommands: guidance.commands,
      guidanceCategory: guidance.category,
      commandSuggestions: guidance.commands,
      command: {
        gitSubcommand: "diff",
        subcommand: inferDiffSubcommand(details, semanticDiffFailed),
        stageId: semanticDiffFailed ? "semantic_diff_numstat" : "name_status_diff",
        ...(commandStderr ? { stderr: commandStderr } : {}),
        ...(commandExitCode !== undefined ? { exitCode: commandExitCode } : {}),
        stderrExcerpt: stderrExcerpt(commandStderr ?? details),
        reproduce: [
          "git diff main...HEAD --name-status",
          "git diff origin/main...HEAD --name-status",
          "sourcevision pr-markdown <project-dir>",
        ],
      },
    };
  }

  if (code === "fetch_failed" || code === "auth_fetch_denied" || code === "network_dns_error") {
    return {
      type: "pr_markdown_refresh_failure",
      code,
      stage: "fetch",
      summary: guidance.summary,
      remediationCommands: guidance.commands,
      guidanceCategory: guidance.category,
      commandSuggestions: guidance.commands,
      command: {
        gitSubcommand: "fetch",
        stageId: "fetch",
        ...(commandStderr ? { stderr: commandStderr } : {}),
        ...(commandExitCode !== undefined ? { exitCode: commandExitCode } : {}),
        stderrExcerpt: stderrExcerpt(commandStderr ?? details),
        reproduce: [
          "git fetch origin main",
          "sourcevision pr-markdown <project-dir>",
        ],
      },
    };
  }

  if (code === "rev_parse_failed" || code === "unresolved_main_or_origin_main") {
    return {
      type: "pr_markdown_refresh_failure",
      code,
      stage: "rev-parse",
      summary: guidance.summary,
      remediationCommands: guidance.commands,
      guidanceCategory: guidance.category,
      commandSuggestions: guidance.commands,
      command: {
        gitSubcommand: "rev-parse",
        stageId: "rev_parse",
        ...(commandStderr ? { stderr: commandStderr } : {}),
        ...(commandExitCode !== undefined ? { exitCode: commandExitCode } : {}),
        stderrExcerpt: stderrExcerpt(commandStderr ?? details),
        reproduce: [
          "git rev-parse --verify main",
          "git rev-parse --verify origin/main",
          "sourcevision pr-markdown <project-dir>",
        ],
      },
    };
  }

  return {
    type: "pr_markdown_refresh_failure",
    code: preflight?.code ?? code,
    stage: "preflight",
    summary: preflight?.summary ?? guidance.summary,
    remediationCommands: preflight?.remediationCommands ?? guidance.commands,
    guidanceCategory: guidance.category,
    commandSuggestions: guidance.commands,
    command: {
      gitSubcommand: "version",
      stageId: "preflight",
      ...(commandStderr ? { stderr: commandStderr } : {}),
      ...(commandExitCode !== undefined ? { exitCode: commandExitCode } : {}),
      stderrExcerpt: stderrExcerpt(commandStderr ?? details),
      reproduce: [
        "git --version",
        "sourcevision pr-markdown <project-dir>",
      ],
    },
  };
}
