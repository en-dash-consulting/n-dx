/**
 * Codex CLI provider — calls Codex via the `codex exec` command.
 *
 * This provider implements the same client contract used by Claude providers:
 * a `complete()` method returning plain text and optional token usage.
 *
 * ## Execution policy compilation
 *
 * The provider compiles an {@link ExecutionPolicy} into Codex-specific CLI
 * flags using the currently supported surface (`--sandbox`, `--full-auto`,
 * `--dangerously-bypass-approvals-and-sandbox`). This keeps the n-dx policy
 * object as the single source of truth for permission intent.
 *
 * @see packages/llm-client/src/runtime-contract.ts — policy types
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md §7.1
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type {
  ClaudeClient,
  CompletionRequest,
  CompletionResult,
} from "./types.js";
import { ClaudeClientError } from "./types.js";
import type { CodexConfig } from "./llm-types.js";
import type { ExecutionPolicy, SandboxMode, ApprovalPolicy } from "./runtime-contract.js";
import { DEFAULT_EXECUTION_POLICY } from "./runtime-contract.js";
import { NEWEST_MODELS } from "./config.js";

const AUTH_PATTERNS = /unauthorized|invalid api key|api key was rejected|forbidden|not logged in|login required|auth failed|\b401\b/i;
const RATE_LIMIT_PATTERNS = /rate.limit|429|too many requests|overloaded/i;
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
  /stream disconnected/i,
];

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 10000;
const DEFAULT_CODEX_BINARY = "codex";
/**
 * Default Codex model ID used when no model is explicitly configured.
 *
 * Exported so the catalog-runtime contract test can cross-reference this
 * value against the orchestration-tier model catalog's `recommended` entry.
 * @see tests/e2e/catalog-runtime-contract.test.js
 */
export const DEFAULT_CODEX_MODEL = NEWEST_MODELS.codex;

export interface CodexCliProviderOptions {
  codexConfig?: CodexConfig;
  /** Execution policy to compile into Codex CLI flags. Defaults to DEFAULT_EXECUTION_POLICY. */
  policy?: ExecutionPolicy;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Called before each rate-limit retry sleep.
   * Receives the upcoming attempt number (1-based, so 2 = first retry),
   * the total attempt count, and the delay in milliseconds.
   * When omitted, a default message is written to stderr.
   */
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void;
}

// ── Policy flag compilation ──────────────────────────────────────────────

/**
 * Map an n-dx {@link SandboxMode} to the Codex CLI `--sandbox` flag value.
 *
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md §6.3
 */
export function mapSandboxToCodexFlag(mode: SandboxMode): string {
  switch (mode) {
    case "read-only":
      return "read-only";
    case "workspace-write":
      return "workspace-write";
    case "danger-full-access":
      return "danger-full-access";
  }
}

/**
 * Map an n-dx {@link ApprovalPolicy} to the closest Codex execution preset.
 *
 * Mapping:
 * - `"on-request"` → `"default"` (use plain `--sandbox`; Codex decides when to prompt)
 * - `"never"` → `"full-auto"` (low-friction unattended execution where supported)
 */
export function mapApprovalToCodexFlag(policy: ApprovalPolicy): string {
  switch (policy) {
    case "on-request":
      return "default";
    case "never":
      return "full-auto";
  }
}

/**
 * Compile an n-dx {@link ExecutionPolicy} into Codex CLI flags.
 *
 * Codex no longer exposes a dedicated `--approval-policy` exec flag, so this
 * compiler maps the normalized policy object onto the supported CLI surface:
 *
 * - `workspace-write + never` → `--full-auto`
 * - `danger-full-access + never` → `--dangerously-bypass-approvals-and-sandbox`
 * - all other combinations → explicit `--sandbox <mode>`
 *
 * @example
 * ```ts
 * compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY)
 * // → ["--full-auto"]
 * ```
 */
export function compileCodexPolicyFlags(policy: ExecutionPolicy): string[] {
  if (policy.approvals === "never") {
    if (policy.sandbox === "workspace-write") {
      return ["--full-auto"];
    }
    if (policy.sandbox === "danger-full-access") {
      return ["--dangerously-bypass-approvals-and-sandbox"];
    }
  }

  return ["--sandbox", mapSandboxToCodexFlag(policy.sandbox)];
}

function isDebugEnabled(): boolean {
  const v = process.env.NDX_DEBUG_LLM ?? process.env.NDX_DEBUG;
  return v === "1" || v === "true" || v === "yes";
}

function debugLog(message: string): void {
  if (isDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.error(`[ndx:llm:codex] ${message}`);
  }
}

function resolveCodexCliPath(codexConfig?: CodexConfig): string {
  return codexConfig?.cli_path ?? DEFAULT_CODEX_BINARY;
}

function resolveCodexModel(codexConfig?: CodexConfig): string {
  return codexConfig?.model ?? DEFAULT_CODEX_MODEL;
}

function isTransientError(message: string): boolean {
  return TRANSIENT_PATTERNS.some((p) => p.test(message));
}

function classifyStderr(stderr: string): { reason: "auth" | "rate-limit" | "unknown"; retryable: boolean } {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const errorLines = lines.filter((line) => /^error:/i.test(line));
  const classificationText = (errorLines.length > 0 ? errorLines.join("\n") : stderr).toLowerCase();

  if (AUTH_PATTERNS.test(classificationText)) {
    return { reason: "auth", retryable: false };
  }
  if (RATE_LIMIT_PATTERNS.test(classificationText)) {
    return { reason: "rate-limit", retryable: true };
  }
  return { reason: "unknown", retryable: isTransientError(classificationText) };
}

async function spawnOnce(
  cliBinary: string,
  request: CompletionRequest,
  codexConfig?: CodexConfig,
  envOverride?: NodeJS.ProcessEnv,
  policy?: ExecutionPolicy,
): Promise<CompletionResult> {
  const dir = await mkdtemp(join(tmpdir(), "ndx-codex-"));
  const outputPath = join(dir, "last-message.txt");

  try {
    const effectivePolicy = policy ?? DEFAULT_EXECUTION_POLICY;
    const policyFlags = compileCodexPolicyFlags(effectivePolicy);
    const args = [
      "exec",
      ...policyFlags,
      "--skip-git-repo-check",
      "-m",
      request.model || resolveCodexModel(codexConfig),
      "-o",
      outputPath,
      ...(request.cliFlags ?? []),
      request.prompt,
    ];
    debugLog(`spawn start cli="${cliBinary}" model="${request.model || resolveCodexModel(codexConfig)}" promptChars=${request.prompt.length}`);
    debugLog(`spawn args: ${JSON.stringify(args)}`);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(cliBinary, args, {
        stdio: ["ignore", "ignore", "pipe"],
        env: envOverride ?? process.env,
        shell: process.platform === "win32",
      });

      let stderr = "";
      let timeoutId: NodeJS.Timeout | undefined;
      let timedOut = false;
      const timeoutMs = request.timeoutMs;
      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, timeoutMs);
      }

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          const pathNote = cliBinary !== DEFAULT_CODEX_BINARY
            ? `Codex CLI not found at configured path: ${cliBinary}. Check 'n-dx config llm.codex.cli_path'.`
            : "Codex CLI not found. Install it and/or set a custom path: n-dx config llm.codex.cli_path /path/to/codex";
          reject(new ClaudeClientError(pathNote, "not-found", false));
          return;
        }
        reject(new ClaudeClientError(err.message, "unknown", isTransientError(err.message)));
      });

      proc.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (timedOut) {
          reject(new ClaudeClientError(`codex exec timed out after ${timeoutMs}ms`, "timeout", true));
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        const detail = stderr.trim() || `codex exited with code ${code}`;
        const classified = classifyStderr(detail);
        debugLog(`spawn close code=${code} classified=${classified.reason} retryable=${classified.retryable}`);
        if (detail) {
          debugLog(`stderr: ${detail}`);
        }
        reject(new ClaudeClientError(detail, classified.reason, classified.retryable));
      });
    });

    let rawText: string;
    try {
      rawText = await readFile(outputPath, "utf-8");
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "ENOENT") {
        throw new ClaudeClientError(
          "codex exec exited successfully but did not write output file",
          "unknown",
          true,
        );
      }
      throw err;
    }

    const text = rawText.trim();
    debugLog(`spawn success outputChars=${text.length}`);

    if (text.length === 0) {
      throw new ClaudeClientError(
        "codex exec produced empty output",
        "unknown",
        true,
      );
    }

    return { text };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function defaultRateLimitOnRetry(attempt: number, maxAttempts: number, delayMs: number): void {
  const delaySec = Math.round(delayMs / 1000);
  process.stderr.write(`Rate limited — retrying in ${delaySec}s… (attempt ${attempt} of ${maxAttempts})\n`);
}

export function createCodexCliClient(options: CodexCliProviderOptions): ClaudeClient {
  const cliBinary = resolveCodexCliPath(options.codexConfig);
  const defaultModel = resolveCodexModel(options.codexConfig);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const onRetry = options.onRetry ?? defaultRateLimitOnRetry;

  return {
    mode: "cli",

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      let lastError: Error | undefined;
      const finalRequest: CompletionRequest = {
        ...request,
        model: request.model || defaultModel,
      };
      let attemptedWithoutApiKey = false;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        debugLog(`complete attempt=${attempt + 1}/${maxRetries + 1} model="${finalRequest.model}"`);
        try {
          return await spawnOnce(cliBinary, finalRequest, options.codexConfig, undefined, options.policy);
        } catch (err) {
          lastError = err as Error;
          if (err instanceof ClaudeClientError) {
            debugLog(`attempt failed reason=${err.reason} retryable=${err.retryable} message="${err.message}"`);
          } else {
            debugLog(`attempt failed unknown error="${(err as Error).message}"`);
          }

          // In some local setups, a stale OPENAI_API_KEY environment variable
          // overrides successful Codex CLI login credentials. If auth fails and
          // no explicit llm.codex.api_key is configured, retry once with the
          // env key removed to allow CLI session auth to take precedence.
          if (
            err instanceof ClaudeClientError &&
            err.reason === "auth" &&
            !attemptedWithoutApiKey &&
            !options.codexConfig?.api_key &&
            typeof process.env.OPENAI_API_KEY === "string" &&
            process.env.OPENAI_API_KEY.length > 0
          ) {
            attemptedWithoutApiKey = true;
            debugLog("auth failure with OPENAI_API_KEY present; retrying once with OPENAI_API_KEY removed");
            const env = { ...process.env };
            delete env.OPENAI_API_KEY;
            try {
              return await spawnOnce(cliBinary, finalRequest, options.codexConfig, env, options.policy);
            } catch (retryErr) {
              lastError = retryErr as Error;
              debugLog(`retry without OPENAI_API_KEY failed: ${(retryErr as Error).message}`);
            }
          }

          if (err instanceof ClaudeClientError && !err.retryable) {
            debugLog("non-retryable error; aborting retries");
            throw err;
          }

          if (attempt < maxRetries) {
            const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
            debugLog(`sleeping before retry delayMs=${delay}`);

            // Surface a user-visible message for rate-limit retries so the
            // command doesn't appear hung. Other transient errors (network
            // resets, server 5xx) retry silently.
            if (err instanceof ClaudeClientError && err.reason === "rate-limit") {
              onRetry(attempt + 2, maxRetries + 1, delay);
            }

            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      debugLog(`exhausted retries; throwing last error: ${lastError?.message ?? "unknown"}`);

      // When all retries are exhausted due to rate limiting, throw an
      // actionable error rather than re-surfacing the raw provider message.
      if (lastError instanceof ClaudeClientError && lastError.reason === "rate-limit") {
        throw new ClaudeClientError(
          `Codex rate limit exceeded — all ${maxRetries + 1} attempts failed. ` +
          "Wait a few minutes and try again, or reduce request frequency.",
          "rate-limit",
          false,
        );
      }

      throw lastError;
    },
  };
}
