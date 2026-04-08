/**
 * CLI error handling — user-friendly errors with optional suggestions.
 *
 * Sourcevision's CLIError extends the foundation CLIError from @n-dx/llm-client,
 * providing a consistent error hierarchy across all n-dx packages.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_ERROR_CODES,
  CLIError as BaseCLIError,
  type CLIErrorCode,
} from "@n-dx/llm-client";
import { SV_DIR } from "./commands/constants.js";

/**
 * Sourcevision CLI error — extends the foundation CLIError.
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
 * Known error patterns mapped to user-friendly messages and suggestions.
 * Each entry: [regex to match, stable code, user-friendly message, suggestion].
 */
const ERROR_HINTS: Array<[RegExp, CLIErrorCode, string, string]> = [
  [
    /ENOENT.*\.sourcevision/,
    CLI_ERROR_CODES.NOT_INITIALIZED,
    "Sourcevision directory not found.",
    "Run 'n-dx init' or 'sourcevision init' to set up analysis.",
  ],
  [
    /ENOENT.*manifest\.json/,
    CLI_ERROR_CODES.SOURCEVISION_MANIFEST_NOT_FOUND,
    "Sourcevision manifest not found.",
    "Run 'sourcevision analyze' to generate analysis output.",
  ],
  [
    /EACCES/,
    CLI_ERROR_CODES.PERMISSION_DENIED,
    "Permission denied.",
    "Check file permissions for the .sourcevision/ directory.",
  ],
  [
    /Unexpected token/,
    CLI_ERROR_CODES.JSON_PARSE_FAILED,
    "Failed to parse JSON file.",
    "Check for syntax errors in the file, or run 'sourcevision reset' to start fresh.",
  ],
  [
    /Directory not found/,
    CLI_ERROR_CODES.DIRECTORY_NOT_FOUND,
    "",  // Use original message
    "Check the path and try again.",
  ],
  [
    /ENOENT/,
    CLI_ERROR_CODES.DIRECTORY_NOT_FOUND,
    "File or directory not found.",
    "Check the path and try again.",
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
 * Format an error for CLI output. Returns lines to print to stderr.
 * Never includes stack traces in the output.
 */
export function formatCLIError(err: unknown): string {
  // CLIError — already user-friendly
  if (err instanceof CLIError) {
    return renderCLIError(err.code, err.message, err.suggestion);
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
 * Check that .sourcevision/ exists in the given directory.
 * Throws a CLIError with an init suggestion if missing.
 */
export function requireSvDir(dir: string): void {
  if (!existsSync(join(dir, SV_DIR))) {
    throw new CLIError(
      `Sourcevision directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'sourcevision init' if using sourcevision standalone.",
      CLI_ERROR_CODES.NOT_INITIALIZED,
    );
  }
}
