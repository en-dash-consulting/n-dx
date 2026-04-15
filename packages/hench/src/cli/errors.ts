/**
 * CLI error handling — user-friendly errors with optional suggestions.
 *
 * Hench's CLIError extends the foundation CLIError from @n-dx/llm-client,
 * providing a consistent error hierarchy across all n-dx packages.
 *
 * ## Vendor-neutral failure taxonomy
 *
 * Raw errors from both Claude and Codex are classified into the shared
 * {@link FailureCategory} taxonomy via {@link classifyVendorError} (from
 * the runtime contract in @n-dx/llm-client). The `formatCLIError` function
 * uses this classification to produce vendor-agnostic user-facing messages,
 * while `ERROR_HINTS` provides additional pattern-matched suggestions for
 * common operational problems from either vendor.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_ERROR_CODES,
  CLIError as BaseCLIError,
  ClaudeClientError,
  type CLIErrorCode,
  PROJECT_DIRS,
  isExecutableOnPath,
  classifyVendorError,
  failureCategoryLabel,
} from "../prd/llm-gateway.js";
import type { FailureCategory } from "../prd/llm-gateway.js";

const HENCH_DIR = PROJECT_DIRS.HENCH;

/**
 * Hench CLI error — extends the foundation CLIError.
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

/** Thrown when an epic specified by --epic flag is not found. */
export class EpicNotFoundError extends CLIError {
  readonly searchTerm: string;
  readonly availableEpics: Array<{ id: string; title: string }>;

  constructor(
    searchTerm: string,
    availableEpics: Array<{ id: string; title: string }>,
  ) {
    const epicList =
      availableEpics.length > 0
        ? `\n\nAvailable epics:\n${availableEpics.map((e) => `  - ${e.title} (${e.id})`).join("\n")}`
        : "\n\nNo epics found in PRD.";

    super(
      `Epic not found: "${searchTerm}"`,
      `Use an epic ID or title from the PRD.${epicList}`,
      CLI_ERROR_CODES.EPIC_NOT_FOUND,
    );
    this.name = "EpicNotFoundError";
    this.searchTerm = searchTerm;
    this.availableEpics = availableEpics;
  }
}

/**
 * Known error patterns mapped to user-friendly messages and suggestions.
 * Each entry: [regex to match, stable code, user-friendly message, suggestion].
 *
 * These patterns cover operational errors (file system, config, binary lookup)
 * from both Claude and Codex vendors. For semantic error classification
 * (auth, rate-limit, timeout), use {@link classifyVendorError} instead.
 */
const ERROR_HINTS: Array<[RegExp, CLIErrorCode, string, string]> = [
  [
    /System memory usage.*exceeds rejection threshold/,
    CLI_ERROR_CODES.MEMORY_THRESHOLD,
    "",  // Use original message (already user-friendly)
    "Close other applications to free memory.\n" +
    "       To adjust thresholds: hench config guard.memoryThrottle.rejectThreshold <number>\n" +
    "       To disable throttling: hench config guard.memoryThrottle.enabled false",
  ],
  [
    /Concurrent process limit reached/,
    CLI_ERROR_CODES.CONCURRENCY_LIMIT,
    "",  // Use original message (already user-friendly)
    "Active hench processes will release their locks when they finish.\n" +
    "       To change the limit: hench config guard.maxConcurrentProcesses <number>",
  ],
  [
    /ENOENT.*\.hench/,
    CLI_ERROR_CODES.NOT_INITIALIZED,
    "Hench directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*\.rex/,
    CLI_ERROR_CODES.NOT_INITIALIZED,
    "Rex directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*config\.json/,
    CLI_ERROR_CODES.CONFIG_NOT_FOUND,
    "Configuration file not found.",
    "Run 'n-dx init' to create default configuration.",
  ],
  [
    /Invalid hench config|Invalid config\.json/,
    CLI_ERROR_CODES.INVALID_CONFIGURATION,
    "Configuration file is corrupted or has an invalid format.",
    "Check .hench/config.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /Invalid run record/,
    CLI_ERROR_CODES.INVALID_RUN_RECORD,
    "Run record is corrupted or has an invalid format.",
    "The run data in .hench/runs/ may be damaged. Check the file for syntax errors.",
  ],
  [
    /EACCES/,
    CLI_ERROR_CODES.PERMISSION_DENIED,
    "Permission denied.",
    "Check file permissions for the .hench/ directory.",
  ],
  [
    /Unexpected token/,
    CLI_ERROR_CODES.JSON_PARSE_FAILED,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or re-initialize with 'n-dx init'.",
  ],
  // Claude CLI
  [
    /claude.*not found|ENOENT.*claude/i,
    CLI_ERROR_CODES.LLM_CLI_NOT_FOUND,
    "Claude CLI not found.",
    "Install it with: npm install -g @anthropic-ai/claude-code\n       Or switch to the API provider: n-dx config hench.provider api",
  ],
  [
    /ANTHROPIC_API_KEY/,
    CLI_ERROR_CODES.API_KEY_MISSING,
    "Anthropic API key not configured.",
    "Set it via 'n-dx config claude.api_key <key>', the ANTHROPIC_API_KEY environment variable, or use 'n-dx config hench.provider cli' for Claude CLI mode.",
  ],
  // Codex CLI
  [
    /codex.*not found|ENOENT.*codex/i,
    CLI_ERROR_CODES.LLM_CLI_NOT_FOUND,
    "Codex CLI not found.",
    "Install Codex CLI and/or set a custom path: n-dx config llm.codex.cli_path /path/to/codex",
  ],
  [
    /OPENAI_API_KEY/,
    CLI_ERROR_CODES.API_KEY_MISSING,
    "OpenAI API key not configured.",
    "Set it via 'n-dx config llm.codex.api_key <key>' or the OPENAI_API_KEY environment variable.",
  ],
  // Generic not-found (must come after vendor-specific patterns)
  [
    /not found/i,
    CLI_ERROR_CODES.RESOURCE_NOT_FOUND,
    "",  // Use original message
    "Check the ID or path and try again.",
  ],
];

function renderCLIError(code: CLIErrorCode, message: string, suggestion?: string): string {
  let formatted = `Error: [${code}] ${message}`;
  if (suggestion) {
    formatted += `\nHint: ${suggestion}`;
  }
  return formatted;
}

/**
 * Per-category user-facing suggestions keyed by {@link FailureCategory}.
 *
 * These are shown alongside the classified error label when the error came
 * from a {@link ClaudeClientError} (which both Claude and Codex providers
 * throw). Entries for categories already covered by ERROR_HINTS regex
 * patterns are intentionally omitted — the regex path takes priority for
 * those because it produces more context-specific messages.
 */
const CATEGORY_SUGGESTIONS: Partial<Record<FailureCategory, string>> = {
  auth: "Check your API key configuration: n-dx config",
  rate_limit: "Wait a moment and try again, or reduce concurrency.",
  timeout: "The operation timed out. Try increasing the timeout or simplifying the task.",
  budget_exceeded: "Token budget exhausted. Increase with: n-dx config hench.tokenBudget <number>",
  transient_exhausted: "Retries exhausted due to transient failures. Check network connectivity and try again.",
};

/**
 * Format an error for CLI output. Returns lines to print to stderr.
 * Never includes stack traces in the output.
 *
 * Classification strategy:
 * 1. {@link BaseCLIError} instances (hench CLIError, TaskNotActionableError)
 *    — use the error's own message and suggestion.
 * 2. {@link ClaudeClientError} instances (from Claude/Codex providers)
 *    — classify via {@link classifyVendorError} and show a category label
 *    with a category-specific suggestion.
 * 3. Pattern matching against {@link ERROR_HINTS} — operational errors
 *    (file system, config, binary lookup).
 * 4. Generic fallback — show the raw message.
 */
export function formatCLIError(err: unknown): string {
  // CLIError hierarchy — catches both hench CLIError and TaskNotActionableError
  // (which extends foundation CLIError from @n-dx/llm-client)
  if (err instanceof BaseCLIError) {
    const code = "code" in err && typeof err.code === "string"
      ? err.code as CLIErrorCode
      : CLI_ERROR_CODES.GENERIC;
    return renderCLIError(code, err.message, err.suggestion);
  }

  // ClaudeClientError (from Claude/Codex providers) — classify into taxonomy
  if (err instanceof ClaudeClientError) {
    const category = classifyVendorError(err);
    const label = failureCategoryLabel(category);
    let msg = `Error [${label}]: ${err.message}`;
    const suggestion = CATEGORY_SUGGESTIONS[category];
    if (suggestion) {
      msg += `\nHint: ${suggestion}`;
    }
    return msg;
  }

  const message = err instanceof Error ? err.message : String(err);

  // Check for known patterns
  for (const [pattern, code, friendly, suggestion] of ERROR_HINTS) {
    if (pattern.test(message)) {
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
 */
export function handleCLIError(err: unknown): never {
  console.error(formatCLIError(err));
  process.exit(1);
}

/**
 * Check that the claude CLI binary is available.
 * If a custom path is provided (from unified config), checks that specific path.
 * Otherwise checks for "claude" on PATH.
 * Throws a CLIError with install instructions and API-provider fallback if missing.
 */
export function requireClaudeCLI(customPath?: string): void {
  requireLLMCLI("claude", customPath);
}

/**
 * Check that the selected vendor CLI binary is available.
 * If a custom path is provided, checks that path; otherwise checks PATH.
 */
export function requireLLMCLI(vendor: "claude" | "codex", customPath?: string): void {
  const binary = vendor === "codex" ? "codex" : "claude";
  const installHint = vendor === "codex"
    ? "Install Codex CLI and/or set a custom path: n-dx config llm.codex.cli_path /path/to/codex"
    : "Install it with: npm install -g @anthropic-ai/claude-code\n" +
      "  Set a custom path: n-dx config claude.cli_path /path/to/claude\n" +
      "  Or switch to the API provider: n-dx config hench.provider api";

  if (customPath) {
    // If config value looks like a command name ("codex", "claude"), resolve on PATH.
    // If it looks like a filesystem path (absolute/relative with slash), require that path.
    const looksLikePath =
      customPath.includes("/") ||
      customPath.includes("\\") ||
      customPath.startsWith(".") ||
      customPath.startsWith("~");

    const exists = looksLikePath ? existsSync(customPath) : isExecutableOnPath(customPath);
    if (!exists) {
      throw new CLIError(
        `${vendor === "codex" ? "Codex" : "Claude"} CLI not found at configured path: ${customPath}`,
        installHint,
        CLI_ERROR_CODES.LLM_CLI_NOT_FOUND,
      );
    }
    return;
  }

  if (!isExecutableOnPath(binary)) {
    throw new CLIError(
      `${vendor === "codex" ? "Codex" : "Claude"} CLI not found.`,
      installHint,
      CLI_ERROR_CODES.LLM_CLI_NOT_FOUND,
    );
  }
}

/**
 * Check that .hench/ exists in the given directory.
 * Throws a CLIError with an init suggestion if missing.
 */
export function requireHenchDir(dir: string): void {
  if (!existsSync(join(dir, HENCH_DIR))) {
    throw new CLIError(
      `Hench directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'hench init' if using hench standalone.",
      CLI_ERROR_CODES.NOT_INITIALIZED,
    );
  }
}
