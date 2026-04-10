/**
 * Codex CLI provider — calls Codex via the `codex exec` command.
 *
 * This provider implements the same client contract used by Claude providers:
 * a `complete()` method returning plain text and optional token usage.
 *
 * ## Execution policy compilation
 *
 * The provider compiles an {@link ExecutionPolicy} into Codex-specific CLI
 * flags (`--sandbox`, `--approval-policy`) instead of relying on the
 * `--full-auto` preset alias. This keeps the n-dx policy object as the
 * single source of truth for permission intent.
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
      return "full-access";
  }
}

/**
 * Map an n-dx {@link ApprovalPolicy} to the Codex CLI `--approval-policy` value.
 *
 * Mapping:
 * - `"on-request"` → `"auto-edit"` (auto-apply edits, ask for shell commands)
 * - `"never"` → `"full-auto"` (auto-approve everything — unattended execution)
 */
export function mapApprovalToCodexFlag(policy: ApprovalPolicy): string {
  switch (policy) {
    case "on-request":
      return "auto-edit";
    case "never":
      return "full-auto";
  }
}

/**
 * Compile an n-dx {@link ExecutionPolicy} into Codex CLI flags.
 *
 * Replaces the `--full-auto` preset alias with explicit `--sandbox` and
 * `--approval-policy` flags derived from the normalized policy object.
 * This ensures the n-dx policy is the single source of truth — Codex CLI
 * presets cannot silently override the intended execution envelope.
 *
 * @example
 * ```ts
 * compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY)
 * // → ["--sandbox", "workspace-write", "--approval-policy", "full-auto"]
 * ```
 */
export function compileCodexPolicyFlags(policy: ExecutionPolicy): string[] {
  return [
    "--sandbox",
    mapSandboxToCodexFlag(policy.sandbox),
    "--approval-policy",
    mapApprovalToCodexFlag(policy.approvals),
  ];
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

    const text = await readFile(outputPath, "utf-8");
    debugLog(`spawn success outputChars=${text.trim().length}`);
    return { text: text.trim() };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createCodexCliClient(options: CodexCliProviderOptions): ClaudeClient {
  const cliBinary = resolveCodexCliPath(options.codexConfig);
  const defaultModel = resolveCodexModel(options.codexConfig);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

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
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      debugLog(`exhausted retries; throwing last error: ${lastError?.message ?? "unknown"}`);
      throw lastError;
    },
  };
}
