/**
 * CLI error handling — user-friendly errors with optional suggestions.
 *
 * Rex's CLIError extends the foundation CLIError from @n-dx/llm-client,
 * providing a consistent error hierarchy across all n-dx packages.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { CLIError as BaseCLIError } from "@n-dx/llm-client";
import { REX_DIR } from "./commands/constants.js";

/**
 * Rex CLI error — extends the foundation CLIError.
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
    );
    this.name = "BudgetExceededError";
  }
}

/**
 * Known error patterns mapped to user-friendly messages and suggestions.
 * Each entry: [regex to match, user-friendly message, suggestion].
 */
const ERROR_HINTS: Array<[RegExp, string, string]> = [
  [
    /ENOENT.*\.rex/,
    "Rex directory not found.",
    "Run 'n-dx init' to set up the project.",
  ],
  [
    /ENOENT.*prd\.json/,
    "PRD file not found.",
    "Run 'n-dx init' to create the initial PRD.",
  ],
  [
    /ENOENT.*config\.json/,
    "Configuration file not found.",
    "Run 'n-dx init' to create default configuration.",
  ],
  [
    /Invalid prd\.json/,
    "PRD file is corrupted or has an invalid format.",
    "Check .rex/prd.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /Invalid config\.json/,
    "Configuration file is corrupted.",
    "Check .rex/config.json for syntax errors, or re-initialize with 'n-dx init'.",
  ],
  [
    /EACCES/,
    "Permission denied.",
    "Check file permissions for the .rex/ directory.",
  ],
  [
    /Unexpected token/,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or re-initialize with 'n-dx init'.",
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
  // CLIError — already user-friendly
  if (err instanceof CLIError) {
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
 * Respects custom exitCode if the error has one.
 */
export function handleCLIError(err: unknown): never {
  console.error(formatCLIError(err));
  const exitCode =
    err instanceof CLIError && "exitCode" in err
      ? (err as CLIError & { exitCode: number }).exitCode
      : 1;
  process.exit(exitCode);
}

/**
 * Check that .rex/ exists in the given directory.
 * Throws a CLIError with an init suggestion if missing.
 */
export function requireRexDir(dir: string): void {
  if (!existsSync(join(dir, REX_DIR))) {
    throw new CLIError(
      `Rex directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'rex init' if using rex standalone.",
    );
  }
}
