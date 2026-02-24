/**
 * CLI error handling — user-friendly errors with optional suggestions.
 *
 * Hench's CLIError extends the foundation CLIError from @n-dx/llm-client,
 * providing a consistent error hierarchy across all n-dx packages.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { CLIError as BaseCLIError, PROJECT_DIRS, isExecutableOnPath } from "@n-dx/llm-client";

const HENCH_DIR = PROJECT_DIRS.HENCH;

/**
 * Hench CLI error — extends the foundation CLIError.
 *
 * Inherits from {@link BaseCLIError} (which extends ClaudeClientError),
 * so `instanceof ClaudeClientError` checks work across the entire error hierarchy.
 */
export class CLIError extends BaseCLIError {
  constructor(message: string, suggestion?: string) {
    super(message, suggestion);
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
    );
    this.name = "EpicNotFoundError";
    this.searchTerm = searchTerm;
    this.availableEpics = availableEpics;
  }
}

/**
 * Known error patterns mapped to user-friendly messages and suggestions.
 * Each entry: [regex to match, user-friendly message, suggestion].
 */
const ERROR_HINTS: Array<[RegExp, string, string]> = [
  [
    /ENOENT.*\.hench/,
    "Hench directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*\.rex/,
    "Rex directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*config\.json/,
    "Configuration file not found.",
    "Run 'n-dx init' to create default configuration.",
  ],
  [
    /Invalid hench config|Invalid config\.json/,
    "Configuration file is corrupted or has an invalid format.",
    "Check .hench/config.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /Invalid run record/,
    "Run record is corrupted or has an invalid format.",
    "The run data in .hench/runs/ may be damaged. Check the file for syntax errors.",
  ],
  [
    /EACCES/,
    "Permission denied.",
    "Check file permissions for the .hench/ directory.",
  ],
  [
    /Unexpected token/,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or re-initialize with 'n-dx init'.",
  ],
  [
    /claude.*not found|ENOENT.*claude/i,
    "Claude CLI not found.",
    "Install it with: npm install -g @anthropic-ai/claude-code\n       Or switch to the API provider: n-dx config hench.provider api",
  ],
  [
    /ANTHROPIC_API_KEY/,
    "Anthropic API key not configured.",
    "Set it via 'n-dx config claude.api_key <key>', the ANTHROPIC_API_KEY environment variable, or use 'n-dx config hench.provider cli' for Claude CLI mode.",
  ],
  [
    /not found/i,
    "",  // Use original message
    "Check the ID or path and try again.",
  ],
];

/**
 * Format an error for CLI output. Returns lines to print to stderr.
 * Never includes stack traces in the output.
 */
export function formatCLIError(err: unknown): string {
  // CLIError hierarchy — catches both hench CLIError and TaskNotActionableError
  // (which extends foundation CLIError from @n-dx/llm-client)
  if (err instanceof BaseCLIError) {
    let msg = `Error: ${err.message}`;
    if (err.suggestion) {
      msg += `\nHint: ${err.suggestion}`;
    }
    return msg;
  }

  const message = err instanceof Error ? err.message : String(err);

  // Check for known patterns
  for (const [pattern, friendly, suggestion] of ERROR_HINTS) {
    if (pattern.test(message)) {
      const displayMsg = friendly || message;
      return `Error: ${displayMsg}\nHint: ${suggestion}`;
    }
  }

  // Generic fallback — show the message, never the stack
  return `Error: ${message}`;
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
      );
    }
    return;
  }

  if (!isExecutableOnPath(binary)) {
    throw new CLIError(
      `${vendor === "codex" ? "Codex" : "Claude"} CLI not found.`,
      installHint,
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
    );
  }
}
