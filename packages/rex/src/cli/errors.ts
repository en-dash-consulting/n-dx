/**
 * CLI error handling — user-friendly errors with optional suggestions.
 *
 * Rex's CLIError extends the foundation CLIError from @n-dx/llm-client,
 * providing a consistent error hierarchy across all n-dx packages.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import {
  CLI_ERROR_CODES,
  CLIError as BaseCLIError,
  AuthFailureError,
  authFailureGuidance,
  type CLIErrorCode,
} from "@n-dx/llm-client";

import { resolveRexPaths } from "../store/index.js";
import { rexDirHoldsPrd } from "../store/prd-model-reader.js";

/**
 * Rex CLI error — extends the foundation CLIError.
 *
 * Inherits from {@link BaseCLIError} (which extends ClaudeClientError),
 * so `instanceof ClaudeClientError` checks work across the entire error hierarchy.
 */
export class CLIError extends BaseCLIError {
  constructor(message: string, suggestion?: string, code?: CLIErrorCode) {
    super(message, suggestion, code);
    this.name = "CLIError";
  }
}

/**
 * Thrown when a budget threshold is exceeded and abort is configured.
 * Exit code 2 to distinguish from general errors (exit code 1).
 */
export class BudgetExceededError extends CLIError {
  exitCode = 2;

  constructor(warnings: string[]) {
    super(
      `Budget exceeded:\n  ${warnings.join("\n  ")}`,
      "Adjust budget with: n-dx config rex.budget.tokens <value> or rex.budget.cost <value>",
      CLI_ERROR_CODES.BUDGET_EXCEEDED,
    );
    this.name = "BudgetExceededError";
  }
}

/**
 * Known error patterns mapped to user-friendly messages and suggestions.
 * Each entry: [regex to match, stable code, user-friendly message, suggestion].
 */
const ERROR_HINTS: Array<[RegExp, CLIErrorCode, string, string]> = [
  [
    /ENOENT.*\.rex/,
    CLI_ERROR_CODES.NOT_INITIALIZED,
    "Rex directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*prd\.json/,
    CLI_ERROR_CODES.PRD_NOT_FOUND,
    "PRD file not found.",
    "Run 'n-dx init' to create the initial PRD.",
  ],
  [
    /ENOENT.*config\.json/,
    CLI_ERROR_CODES.CONFIG_NOT_FOUND,
    "Configuration file not found.",
    "Run 'n-dx init' to create default configuration.",
  ],
  [
    /Invalid prd\.json/,
    CLI_ERROR_CODES.INVALID_PRD,
    "PRD file is corrupted or has an invalid format.",
    "Check .rex/prd.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /Invalid config\.json/,
    CLI_ERROR_CODES.INVALID_CONFIGURATION,
    "Configuration file is corrupted.",
    "Check .rex/config.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /EACCES/,
    CLI_ERROR_CODES.PERMISSION_DENIED,
    "Permission denied.",
    "Check file permissions for the .rex/ directory.",
  ],
  [
    /Unexpected token/,
    CLI_ERROR_CODES.JSON_PARSE_FAILED,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or re-initialize with 'n-dx init'.",
  ],

  // ── LLM-specific patterns ──────────────────────────────────────────
  [
    /\b429\b|rate limit|too many requests/i,
    CLI_ERROR_CODES.LLM_RATE_LIMITED,
    "Rate limit exceeded — the API is temporarily throttling requests.",
    "Wait a few minutes and try again, or use a different model with --model.",
  ],
  [
    /\b401\b|invalid.*api.*key|authentication.*(fail|error|invalid|expired)|unauthorized.*(request|access|error)/i,
    CLI_ERROR_CODES.AUTH_FAILED,
    "Authentication failed — Invalid or expired credentials.",
    "Re-authenticate: claude logout && claude login (or codex logout && codex login); for Google set ndx config llm.google.api_key <KEY>.",
  ],
  [
    /etimedout|timeout|timed?\s*out/i,
    CLI_ERROR_CODES.TIMEOUT,
    "Request timed out before the API responded.",
    "Retry with a shorter input, or check your network connection.",
  ],
  [
    /\b(529|503)\b|overloaded/i,
    CLI_ERROR_CODES.LLM_SERVER_ERROR,
    "The API is temporarily overloaded or experiencing errors.",
    "Wait a moment and retry. Consider using a different model with --model.",
  ],

  [
    /not found/i,
    CLI_ERROR_CODES.RESOURCE_NOT_FOUND,
    "",  // Use original message
    "Check the ID or path and try again.",
  ],
];

/** Hints that tell the operator the project has no PRD and to run `n-dx init`. */
const UNINITIALIZED_CODES: ReadonlySet<CLIErrorCode> = new Set([
  CLI_ERROR_CODES.NOT_INITIALIZED,
  CLI_ERROR_CODES.PRD_NOT_FOUND,
]);

/**
 * Whether the file a missing-file error names sits in a directory that holds
 * a PRD in either layout. Such a project is initialized — a v2 tree, say, has
 * no `prd.json` by design — so "run n-dx init" would be wrong advice.
 */
function missingFileBesidePrd(message: string): boolean {
  const path = /'([^']+)'/.exec(message)?.[1];
  return path !== undefined && isAbsolute(path) && rexDirHoldsPrd(dirname(path));
}

function renderCLIError(code: CLIErrorCode, message: string, suggestion?: string): string {
  let formatted = `Error: [${code}] ${message}`;
  if (suggestion) {
    formatted += `\nHint: ${suggestion}`;
  }
  return formatted;
}

/**
 * Format an error for CLI output. Returns lines to print to stderr.
 * Never includes a stack trace unless debug is true.
 */
export function formatCLIError(err: unknown, debug = false): string {
  let formatted = formatCLIErrorMessage(err);
  if (debug && err instanceof Error && err.stack) {
    formatted += `\n\n${err.stack}`;
  }
  return formatted;
}

function formatCLIErrorMessage(err: unknown): string {
  // CLIError — already user-friendly
  if (err instanceof CLIError) {
    return renderCLIError(err.code, err.message, err.suggestion);
  }

  // AuthFailureError carries a canonical, JSON-free message and knows its
  // provider — render it with the shared re-auth remediation so ndx plan /
  // ndx analyze read identically to the preflight and ndx work.
  if (err instanceof AuthFailureError) {
    const remediation = authFailureGuidance(err.provider).remediation.join(" · ");
    return renderCLIError(CLI_ERROR_CODES.AUTH_FAILED, err.message, remediation);
  }

  const message = err instanceof Error ? err.message : String(err);

  // Check for known patterns
  for (const [pattern, code, friendly, suggestion] of ERROR_HINTS) {
    if (pattern.test(message)) {
      if (UNINITIALIZED_CODES.has(code) && missingFileBesidePrd(message)) continue;
      const displayMsg = friendly || message;
      return renderCLIError(code, displayMsg, suggestion);
    }
  }

  // Generic fallback — show the message, never the stack
  return renderCLIError(CLI_ERROR_CODES.GENERIC, message);
}

/**
 * Handle a CLI error: print it and exit.
 * Drop-in replacement for catch blocks in CLI entry points.
 * Respects custom exitCode if the error has one.
 * Pass debug=true (from --debug) to append the stack trace.
 */
export function handleCLIError(err: unknown, debug = false): never {
  console.error(formatCLIError(err, debug));
  const exitCode =
    err instanceof CLIError && "exitCode" in err
      ? (err as CLIError & { exitCode: number }).exitCode
      : 1;
  process.exit(exitCode);
}

/**
 * Refuse a command that rewrites the repository's PRD layout when it runs
 * inside an `ndx work` agent run (`NDX_AGENT_RUN` set). An operator migrates
 * from their own shell; an agent working in the repository must not.
 */
export function refuseInsideAgentRun(command: string): void {
  if (process.env.NDX_AGENT_RUN) {
    throw new CLIError(
      `${command} refuses inside an agent run (NDX_AGENT_RUN is set).`,
      "An operator runs the migration from their own shell.",
    );
  }
}

/**
 * Check that .rex/ exists in the given directory.
 * Throws a CLIError with an init suggestion if missing.
 */
export function requireRexDir(dir: string): void {
  if (!existsSync(resolveRexPaths(dir).rexDir)) {
    throw new CLIError(
      `Rex directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'rex init' if using rex standalone.",
      CLI_ERROR_CODES.NOT_INITIALIZED,
    );
  }
}
