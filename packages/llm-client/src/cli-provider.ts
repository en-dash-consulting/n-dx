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
import type { LLMProvider, ProviderInfo } from "./provider-interface.js";

/** Regex patterns for stderr content indicating a missing binary (Windows shell). */
const NOT_FOUND_PATTERNS = /is not recognized as an internal or external command|cannot find the path|The system cannot find the file specified/i;

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
      "-p", "-",
      "--output-format", format,
      "--model", request.model,
      ...(request.cliFlags ?? []),
    ];

    // Strip CLAUDECODE so the spawned claude process doesn't think it's
    // nested inside an interactive Claude Code session (e.g. when the web
    // server is launched from within Claude Code).
    const { CLAUDECODE: _, ...cleanEnv } = process.env;
    const proc = spawn(cliBinary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: cleanEnv,
    });
    proc.stdin.on("error", () => {/* handled by proc error/close */});
    proc.stdin.write(request.prompt);
    proc.stdin.end();

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

      // On Windows with shell: true, a missing binary doesn't trigger ENOENT —
      // cmd.exe spawns fine but exits non-zero with a "not recognized" message.
      if (NOT_FOUND_PATTERNS.test(detail)) {
        const pathNote = cliBinary !== "claude"
          ? `Claude CLI not found at configured path: ${cliBinary}. Check 'n-dx config claude.cli_path'.`
          : "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code, or set a custom path: n-dx config claude.cli_path /path/to/claude";
        reject(new ClaudeClientError(pathNote, "not-found", false));
        return;
      }

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
 * Create a CLI-based Claude client that implements both the legacy
 * {@link ClaudeClient} interface and the generic {@link LLMProvider} interface.
 *
 * Spawns the `claude` binary for each completion request, with automatic
 * retry on transient failures and exponential backoff.
 *
 * Note: The CLI provider does not implement `validateAuth()` because the
 * Claude CLI authenticates through a browser session that cannot be probed
 * programmatically without making a real completion request.
 */
export function createCliClient(options: CliProviderOptions): ClaudeClient & LLMProvider {
  const cliBinary = resolveCliPath(options.claudeConfig);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  const info: ProviderInfo = {
    vendor: "claude",
    mode: "cli",
    ...(options.claudeConfig.model ? { model: options.claudeConfig.model } : {}),
    capabilities: [],
  };

  return {
    // ── LLMProvider ──────────────────────────────────────────────────────
    info,

    // ── ClaudeClient (backward compat) ───────────────────────────────────
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
