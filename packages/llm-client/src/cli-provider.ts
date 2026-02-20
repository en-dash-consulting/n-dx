/**
 * CLI provider — calls Claude via the `claude` CLI binary.
 *
 * One half of the dual provider architecture. The CLI provider spawns the
 * Claude Code CLI binary and parses its output (JSON or stream-json format).
 *
 * ## When this provider is selected
 *
 * - Explicitly via `createClient({ mode: "cli" })`
 * - As the automatic fallback when no API key is available
 *
 * ## Use cases
 *
 * - Local development where Claude Code is already installed
 * - Environments where the CLI handles authentication (OAuth, session tokens)
 * - When leveraging CLI-specific features (output formats, CLI flags)
 *
 * ## Error handling
 *
 * Stderr output is classified into error categories (auth, rate-limit, unknown)
 * with automatic retry on transient failures using exponential backoff with
 * a configurable maximum delay cap.
 *
 * @see {@link createClient} in `create-client.ts` for provider selection logic
 * @see {@link createApiClient} in `api-provider.ts` for the alternative provider
 */

import { spawn } from "node:child_process";
import type {
  ClaudeClient,
  ClaudeClientOptions,
  CompletionRequest,
  CompletionResult,
  TokenUsage,
} from "./types.js";
import { ClaudeClientError } from "./types.js";
import { resolveCliPath } from "./config.js";
import { parseCliTokenUsage, parseStreamTokenUsage } from "./token-usage.js";

/** Regex patterns for stderr content indicating an auth error. */
const AUTH_PATTERNS = /auth|unauthorized|api.key|credential|login|not logged in/i;

/** Regex patterns for stderr content indicating a rate-limit error. */
const RATE_LIMIT_PATTERNS = /rate.limit|429|too many requests|overloaded/i;

/** Regex patterns in error messages that indicate a transient failure. */
const TRANSIENT_PATTERNS = [
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b529\b/,
  /\b429\b/,
  /overloaded/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /socket hang up/i,
];

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;

/** Options specific to the CLI provider. */
export interface CliProviderOptions extends ClaudeClientOptions {
  /** Maximum number of retries for transient failures (default: 2). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000). */
  baseDelayMs?: number;
  /** Maximum delay in ms for backoff (default: 10000). */
  maxDelayMs?: number;
}

/**
 * Classify an error message as retryable or not.
 */
function isTransientError(message: string): boolean {
  return TRANSIENT_PATTERNS.some((p) => p.test(message));
}

/**
 * Classify stderr content into a structured error reason.
 */
function classifyStderr(stderr: string): { reason: "auth" | "rate-limit" | "unknown"; retryable: boolean } {
  if (AUTH_PATTERNS.test(stderr)) {
    return { reason: "auth", retryable: false };
  }
  if (RATE_LIMIT_PATTERNS.test(stderr)) {
    return { reason: "rate-limit", retryable: true };
  }
  return { reason: "unknown", retryable: isTransientError(stderr) };
}

/**
 * Spawn the Claude CLI once and collect the result.
 */
function spawnOnce(
  cliBinary: string,
  request: CompletionRequest,
): Promise<CompletionResult> {
  return new Promise((resolve, reject) => {
    const format = request.outputFormat ?? "json";
    const args = [
      "-p", request.prompt,
      "--output-format", format,
      "--model", request.model,
      ...(request.cliFlags ?? []),
    ];

    const proc = spawn(cliBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const pathNote = cliBinary !== "claude"
          ? `Claude CLI not found at configured path: ${cliBinary}. Check 'n-dx config claude.cli_path'.`
          : "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code, or set a custom path: n-dx config claude.cli_path /path/to/claude";
        reject(new ClaudeClientError(pathNote, "not-found", false));
      } else {
        reject(new ClaudeClientError(err.message, "unknown", isTransientError(err.message)));
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        if (format === "json") {
          resolve(parseJsonOutput(stdout));
        } else {
          resolve(parseStreamOutput(stdout));
        }
        return;
      }

      const detail = stderr.trim() || `claude exited with code ${code}`;
      const classified = classifyStderr(detail);
      reject(new ClaudeClientError(detail, classified.reason, classified.retryable));
    });
  });
}

/**
 * Parse --output-format json envelope: { result: "...", input_tokens, ... }
 */
function parseJsonOutput(stdout: string): CompletionResult {
  try {
    const envelope = JSON.parse(stdout) as Record<string, unknown>;
    const text = typeof envelope.result === "string" ? envelope.result : stdout;
    const tokenUsage = parseCliTokenUsage(envelope);
    return { text, tokenUsage };
  } catch {
    return { text: stdout };
  }
}

/**
 * Parse --output-format stream-json: newline-delimited JSON events.
 * Looks for a { type: "result" } event.
 */
function parseStreamOutput(stdout: string): CompletionResult {
  let resultText = "";
  let tokenUsage: TokenUsage | undefined;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === "result") {
        resultText = typeof obj.result === "string" ? obj.result : "";
        tokenUsage = parseStreamTokenUsage(obj);
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return { text: resultText, tokenUsage };
}

/**
 * Create a CLI-based Claude client.
 *
 * Spawns the `claude` binary for each completion request, with automatic
 * retry on transient failures and exponential backoff.
 */
export function createCliClient(options: CliProviderOptions): ClaudeClient {
  const cliBinary = resolveCliPath(options.claudeConfig);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  return {
    mode: "cli",

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await spawnOnce(cliBinary, request);
        } catch (err) {
          lastError = err as Error;

          // Don't retry non-retryable errors
          if (err instanceof ClaudeClientError && !err.retryable) {
            throw err;
          }

          // Don't retry on last attempt
          if (attempt < maxRetries) {
            const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      throw lastError;
    },
  };
}
