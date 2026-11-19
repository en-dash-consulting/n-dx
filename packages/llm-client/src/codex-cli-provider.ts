/**
 * Codex CLI provider — calls Codex via the `codex exec` command.
 *
 * This provider implements the same client contract used by Claude providers:
 * a `complete()` method returning plain text and optional token usage.
 *
 * ## Execution policy compilation
 *
 * The provider compiles an {@link ExecutionPolicy} into Codex-specific CLI
 * flags using the currently supported surface (`--sandbox`,
 * `--dangerously-bypass-approvals-and-sandbox`). This keeps the n-dx policy
 * object as the single source of truth for permission intent.
 *
 * `--full-auto` was removed from the Codex CLI (gone as of codex-cli
 * 0.147.0's `exec` subcommand) — `workspace-write + never` now compiles to
 * the equivalent explicit `--sandbox workspace-write`, since `codex exec`
 * is already non-interactive and has no approval-prompt surface to disable.
 *
 * @see packages/llm-client/src/runtime-contract.ts — policy types
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md §7.1
 */

import { codexEffortFlags, resolveCodexCliEffort } from "./codex-effort.js";
import { assertCodexScratchEnvironment } from "./codex-scratch-env.js";

import { CodexCliUsage } from "./codex-cli-usage.js";
import { mkdir, readFile } from "node:fs/promises";
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdtempSync, openSync, readdirSync, realpathSync, rmdirSync, rmSync, type BigIntStats } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  ClaudeClient,
  CompletionRequest,
  CompletionResult,
} from "./types.js";
import { classifyLLMError } from "./llm-error-classifier.js";
import { CLI_ERROR_CODES, ClaudeClientError } from "./types.js";
import type { CodexConfig } from "./llm-types.js";
import type { ExecutionPolicy, SandboxMode, ApprovalPolicy } from "./runtime-contract.js";
import { DEFAULT_EXECUTION_POLICY } from "./runtime-contract.js";
import { NEWEST_MODELS } from "./config.js";
import { diagnoseCliInvocation, diagnoseCliNotFound, spawnCli } from "./exec.js";
import { printRetryLine } from "./progress-reporter.js";
import { formatRetryCountdown } from "./rate-limit.js";
import { resolveVendorCliEnv } from "./child-env.js";

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
/**
 * The `--sandbox` values `codex exec` accepts.
 *
 * From `codex exec --help`: `[possible values: read-only, workspace-write,
 * danger-full-access]`.
 */
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/**
 * The `approval_policy` config values codex accepts.
 *
 * Not a stylistic narrowing — this union is the guard. Returning a string
 * codex rejects kills the spawn at config-load time, before the model is
 * reached, and it happened: the mappers once returned `"default"` and
 * `"full-auto"`, which are `codex exec` *flag* names rather than
 * `approval_policy` variants. Typing the return makes that a compile error on
 * every machine, including CI, where codex is not installed and the
 * drift test in `codex-flag-surface.test.ts` skips.
 *
 * Read off codex-cli 0.147.0's own rejection of a bogus value:
 * ``unknown variant `x`, expected one of `untrusted`, `on-failure`,
 * `on-request`, `granular`, `never` ``.
 */
export type CodexApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "granular"
  | "never";

export function mapSandboxToCodexFlag(mode: SandboxMode): CodexSandboxMode {
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
 * Map an n-dx {@link ApprovalPolicy} to a Codex `approval_policy` config value.
 *
 * Codex exec has no approval *flag* — the policy is a config key, set with
 * `-c approval_policy=<value>`. Its accepted variants, read off the CLI's own
 * rejection message on codex-cli 0.147.0, are `untrusted`, `on-failure`,
 * `on-request`, `granular`, and `never`; n-dx's two policy names happen to be
 * spelled identically to the two we need.
 *
 * This used to return the preset names `"default"` and `"full-auto"`. Those
 * were names of `codex exec` flags, not config values, and both are gone from
 * the exec surface — see {@link compileCodexPolicyFlags}.
 */
export function mapApprovalToCodexFlag(policy: ApprovalPolicy): CodexApprovalPolicy {
  switch (policy) {
    case "on-request":
      return "on-request";
    case "never":
      return "never";
  }
}

/**
 * Compile an n-dx {@link ExecutionPolicy} into `codex exec` flags.
 *
 * Both halves of the policy are always stated explicitly:
 *
 * - sandbox → `--sandbox <mode>`
 * - approvals → `-c approval_policy=<value>` (no exec flag exists for it)
 *
 * The one preset kept is `danger-full-access + never`, which maps to
 * `--dangerously-bypass-approvals-and-sandbox` — still on the exec surface,
 * and the only way to express "no sandbox at all".
 *
 * `workspace-write + never` — the autonomous default — used to compile to
 * `--full-auto`. codex-cli 0.147.0 removed that flag from `codex exec`, so
 * every unattended spawn died on argument parsing before reaching the model.
 * Stating sandbox and approvals separately is also more robust than a preset:
 * a preset is a name codex can retire, while `--sandbox` and `approval_policy`
 * are the underlying settings it is composed from.
 *
 * Every result ends with {@link codexShellEnvFlags}, which keeps the Codex
 * credentials out of the commands the agent runs.
 * Every mode requires strict config parsing. Full access is only representable
 * with network access enabled and no bounded writable roots; read-only cannot
 * grant network access through these legacy controls. Contradictory requests
 * throw before spawning. In read-only mode writable roots grant no writes.
 *
 * `codex exec resume` rejects `--sandbox` and the bypass flag, yet a resumed
 * thread does not keep its starting policy: resume reads sandbox and approval
 * from the invocation's config, so without overrides the user's
 * `~/.codex/config.toml` decides. `{ resume: true }` therefore states both
 * halves as `-c` overrides, `sandbox_mode="<mode>"` and
 * `approval_policy="<value>"`, for every policy (`danger-full-access + never`
 * included: no bypass flag on resume), then the shell-environment overrides.
 * Verified on codex-cli 0.164.0-alpha.11.1: a thread started workspace-write
 * and resumed with `sandbox_mode="read-only"` recorded read-only, and a write
 * on the resumed turn was denied.
 *
 * @example
 * ```ts
 * compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY)
 * // → ["--sandbox", "workspace-write", "-c", "approval_policy=never",
 * //    "-c", "shell_environment_policy.set.OPENAI_API_KEY=''", …]
 * compileCodexPolicyFlags(DEFAULT_EXECUTION_POLICY, { resume: true })
 * // → ["-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"',
 * //    "-c", "shell_environment_policy.set.OPENAI_API_KEY=''", …]
 * ```
 */
export function compileCodexPolicyFlags(
  policy: ExecutionPolicy,
  options: { resume?: boolean; scratchDir?: string } = {},
): string[] {
  // A disabled sandbox cannot enforce a network or writable-root restriction.
  // Refuse contradictory policies instead of silently discarding their limits.
  if (policy.sandbox === "danger-full-access") {
    if (!policy.networkAccess) {
      throw new Error("Codex danger-full-access cannot enforce networkAccess=false; use workspace-write or read-only");
    }
    if (policy.writableRoots.length > 0) {
      throw new Error("Codex danger-full-access cannot enforce writableRoots; use workspace-write for bounded writes");
    }
  }
  if (policy.sandbox === "read-only" && policy.networkAccess) {
    throw new Error("Codex read-only cannot express networkAccess=true through the supported legacy sandbox controls");
  }
  // Replace the whole table: inherited roots or network grants must not
  // survive a more restrictive n-dx policy. Codex always grants the cwd in
  // workspace-write mode, so a narrower root list cannot be represented.
  // Only dot components and separators are interchangeable here. Collapsing
  // "dir/.." could cross a symlink and incorrectly authorize the entire cwd.
  const additionalRoots = policy.writableRoots.filter(root => {
    const path = process.platform === "win32" ? root.replaceAll("\\", "/") : root;
    return !/^\.(?:\/+\.)*\/*$/.test(path);
  });
  if (policy.sandbox === "workspace-write" && additionalRoots.length === policy.writableRoots.length) {
    throw new Error("Codex workspace-write always permits the project root; writableRoots must include '.' or use read-only");
  }
  const scratchDir = policy.sandbox === "workspace-write" ? options.scratchDir : undefined;
  if (scratchDir) additionalRoots.push(scratchDir);
  const shellFlags = [
    ...(scratchDir ? ["TMPDIR", "TMP", "TEMP"].flatMap(name => [
      "-c", `shell_environment_policy.set.${name}=${JSON.stringify(scratchDir)}`,
    ]) : []),
    ...codexShellEnvFlags(),
  ];
  // Strict parsing is required in every mode, including continuation turns.
  // Older CLIs must reject the flag rather than ignore unfamiliar controls.
  const workspaceFlags = ["--strict-config", ...(policy.sandbox === "workspace-write" ? [
    "-c",
    `sandbox_workspace_write={network_access=${policy.networkAccess},writable_roots=${JSON.stringify(additionalRoots)},exclude_tmpdir_env_var=true,exclude_slash_tmp=true}`,
  ] : [])];
  if (options.resume) {
    return [
      "-c",
      `sandbox_mode="${mapSandboxToCodexFlag(policy.sandbox)}"`,
      "-c",
      `approval_policy="${mapApprovalToCodexFlag(policy.approvals)}"`,
      ...workspaceFlags, ...shellFlags,
    ];
  }
  if (policy.approvals === "never" && policy.sandbox === "danger-full-access") {
    return ["--dangerously-bypass-approvals-and-sandbox", ...workspaceFlags, ...codexShellEnvFlags()];
  }

  return [
    "--sandbox",
    mapSandboxToCodexFlag(policy.sandbox),
    "-c",
    `approval_policy=${mapApprovalToCodexFlag(policy.approvals)}`,
    ...workspaceFlags, ...shellFlags,
  ];
}

const activeScratch = new Set<ReturnType<typeof createCodexScratch>>();
function scratchEnv(dir: string): Record<string, string> {
  return { TMPDIR: dir, TMP: dir, TEMP: dir };
}

function disposeActiveScratch(): void {
  for (const scratch of activeScratch) scratch.dispose();
}

/** Pin each parent while addressing its immediate entries. A surviving writer
 * can rename a nested directory after open; its old pathname is no longer a
 * safe base for either permission changes or recursive removal.
 */
function removeScratchEntry(path: string, stat: BigIntStats): void {
  if (!stat.isDirectory()) {
    rmSync(path, { force: true });
    return;
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error("Scratch directory changed during cleanup");
    // Darwin's file-ID path names the open vnode. On Linux, procfs names the
    // open descriptor directly. Keep it open through removal to pin its ID.
    const anchor = process.platform === "darwin" ? `/.vol/${opened.dev}/${opened.ino}`
      : process.platform === "linux" ? `/proc/self/fd/${fd}` : `/dev/fd/${fd}`;
    if ((opened.mode & 0o700n) !== 0o700n) fchmodSync(fd, Number(opened.mode & 0o7777n) | 0o700);
    for (const name of readdirSync(anchor)) {
      const entry = join(anchor, name);
      removeScratchEntry(entry, lstatSync(entry, { bigint: true }));
    }
    rmdirSync(path);
  } finally {
    closeSync(fd);
  }
}

/** Owned by one spawn, never by a resumable thread. Only this private child
 * directory is granted, never the host temp root. mkdtemp creates mode 0700.
 * Normal completion awaits child exit before disposal; exit is the fallback.
 */
export function createCodexScratch(): { dir: string; env: Record<string, string>; dispose(): void } {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "ndx-codex-scratch-"));
  const owner = lstatSync(dir, { bigint: true });
  let disposed = false;
  const scratch = {
    dir,
    env: scratchEnv(dir),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      activeScratch.delete(scratch);
      if (activeScratch.size === 0) process.removeListener("exit", disposeActiveScratch);
      try {
        const current = lstatSync(dir, { bigint: true, throwIfNoEntry: false });
        if (!current) return;
        if (!current.isDirectory() || current.dev !== owner.dev || current.ino !== owner.ino) {
          throw new Error("Scratch root was replaced");
        }
        // Windows rm handles read-only attributes itself; POSIX needs directory
        // write permission even when force:true is specified.
        if (process.platform === "win32") rmSync(dir, { recursive: true, force: true });
        else removeScratchEntry(dir, owner);
      } catch {
        // Cleanup must not replace a successful result, a child failure or abort.
        // Report once, without publishing untrusted filenames or error payloads.
        process.emitWarning(`Could not remove private Codex scratch ${dir}; remove this directory after checking its ownership.`,
          { code: "NDX_CODEX_SCRATCH_CLEANUP" });
      }
    },
  };
  if (activeScratch.size === 0) process.once("exit", disposeActiveScratch);
  activeScratch.add(scratch);
  return scratch;
}

/**
 * The Codex credential names the agent's shell commands must not read: the
 * key `resolveVendorCliEnv` writes under `llm.codex.auth` `api`, and the two
 * tokens codex itself accepts.
 */
export const CODEX_AGENT_HIDDEN_ENV = ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"] as const;

/**
 * `-c` overrides that blank each {@link CODEX_AGENT_HIDDEN_ENV} name in the
 * environment of every command the Codex agent runs.
 *
 * Codex builds that environment from `shell_environment_policy`: `inherit`,
 * then the default `*KEY*`/`*SECRET*`/`*TOKEN*` excludes unless
 * `ignore_default_excludes`, then `exclude`, then `set`, then `include_only`
 * (https://developers.openai.com/codex/config-advanced). The user's
 * `~/.codex/config.toml` can turn every filter off, so excluding is not
 * enough; `set` runs after the excludes and an `-c` override of one `set`
 * entry outranks the user's value for it, so each name reaches the command
 * empty whatever that config says. Codex's own process keeps the real key:
 * `set` applies only to the commands it spawns. A dotted `-c` path replaces
 * that one entry and leaves the user's other `set` entries alone. `''` is a
 * TOML literal string, which needs no quoting on any platform.
 *
 * `extraHidden` blanks more names the same way: variables a caller sets in
 * the Codex child's own environment for Codex itself to read (the Sidecar's
 * broker header variables). Each must be a bare TOML key; any other name
 * throws rather than reach argv as a malformed path.
 *
 * Every `codex exec` n-dx spawns carries these: the provider and hench's
 * adapter through {@link compileCodexPolicyFlags}, core's reviewer and auth
 * check through `loadCodexShellEnvFlags` in its config module.
 */
export function codexShellEnvFlags(extraHidden: readonly string[] = []): string[] {
  const builtIn: readonly string[] = CODEX_AGENT_HIDDEN_ENV;
  const names = [...builtIn, ...extraHidden.filter((name, i) => !builtIn.includes(name) && extraHidden.indexOf(name) === i)];
  return names.flatMap((name) => {
    if (!ENV_NAME_RE.test(name)) {
      throw new Error(`Cannot blank ${JSON.stringify(name)} in Codex's commands: not an environment variable name`);
    }
    return ["-c", `shell_environment_policy.set.${name}=''`];
  });
}

/** A portable environment variable name, which is also a bare TOML key. */
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export function resolveCodexCliPath(codexConfig?: CodexConfig): string {
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
  env: NodeJS.ProcessEnv,
  codexConfig?: CodexConfig,
  policy?: ExecutionPolicy,
): Promise<CompletionResult> {
  const scratch = createCodexScratch();
  const dir = scratch.dir;
  const outputPath = join(dir, "last-message.txt");
  const usage = new CodexCliUsage();

  try {
    const effectivePolicy = policy ?? DEFAULT_EXECUTION_POLICY;
    // Keep the CLI's result file outside the temp root granted to its commands.
    const scratchDir = effectivePolicy.sandbox === "workspace-write" ? join(dir, "tmp") : undefined;
    if (scratchDir) {
      await mkdir(scratchDir, { mode: 0o700 });
      env = { ...env, ...scratchEnv(scratchDir) };
    }
    const policyFlags = compileCodexPolicyFlags(effectivePolicy, { scratchDir });
    const effort = await resolveCodexCliEffort(request.model || resolveCodexModel(codexConfig), request.effort,
      { binary: cliBinary, env, cwd: process.cwd() }, request.taskClass);
    const args = [
      "exec",
      "--json",
      ...policyFlags,
      "--skip-git-repo-check",
      "-m",
      request.model || resolveCodexModel(codexConfig),
      "-o",
      outputPath,
      ...(request.cliFlags ?? []),
      ...codexEffortFlags(effort),
      "-",
    ];
    if (scratchDir) {
      await assertCodexScratchEnvironment({ binary: cliBinary, args, cwd: process.cwd(), env, scratchDir });
    }
    debugLog(`spawn start cli="${cliBinary}" model="${request.model || resolveCodexModel(codexConfig)}" promptChars=${request.prompt.length}`);
    debugLog(`spawn args: ${JSON.stringify(args)}`);

    await new Promise<void>((resolve, reject) => {
      // Windows-safe spawn (GH #37/#68/#69): routes .cmd shims through cmd.exe
      // with a self-quoted verbatim command line instead of shell:true+args.
      const proc = spawnCli(cliBinary, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });

      proc.stdout?.setEncoding("utf8");
      proc.stdout?.on("data", (chunk: string) => usage.push(chunk));

      // No-op stdin error guard: a fast-exiting cmd.exe shim can EPIPE the
      // prompt write before the close handler runs. Without a listener the
      // 'error' event would crash the process before the friendly diagnosis
      // is produced. Mirrors cli-provider.ts.
      proc.stdin!.on("error", () => {/* handled by proc error/close */});
      proc.stdin!.write(request.prompt);
      proc.stdin!.end();

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

      proc.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          const diagnosis = diagnoseCliInvocation(cliBinary, "llm.codex.cli_path");
          reject(new ClaudeClientError(diagnosis.message, "not-found", false));
          return;
        }
        reject(new ClaudeClientError(err.message, "unknown", isTransientError(err.message)));
      });

      proc.on("close", (code) => {
        usage.finish(); // Flush a final JSON event without a trailing newline.
        if (timeoutId) clearTimeout(timeoutId);
        if (timedOut) {
          reject(new ClaudeClientError(`codex exec timed out after ${timeoutMs}ms`, "timeout", true));
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        const detail = usage.failureMessage || stderr.trim() || `codex exited with code ${code}`;

        // On Windows the cmd.exe shim spawns fine but exits non-zero with a
        // "not recognized" / "cannot find the path" message when the binary is
        // missing — no ENOENT is raised. Route that through diagnoseCliNotFound
        // just like the non-Windows ENOENT path above; it anchors to the binary
        // (confirming via existsSync/PATH) and preserves the raw stderr detail.
        const notFoundMessage = diagnoseCliNotFound(detail, cliBinary, "llm.codex.cli_path");
        if (notFoundMessage) {
          reject(new ClaudeClientError(notFoundMessage, "not-found", false));
          return;
        }

        const diagnosis = classifyLLMError(new Error(detail), "codex");
        if (diagnosis.code === CLI_ERROR_CODES.INVALID_CONFIGURATION) {
          reject(new ClaudeClientError(`${detail}\n${diagnosis.suggestion}`, "unknown", false));
          return;
        }

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

    return { text: rawText, ...usage.finish() };
  } catch (error) {
    if (error instanceof Error) Object.assign(error, usage.finish());
    throw error;
  } finally {
    scratch.dispose();
  }
}

function defaultRateLimitOnRetry(attempt: number, maxAttempts: number, delayMs: number): void {
  const countdown = formatRetryCountdown(Math.round(delayMs / 1000));
  printRetryLine(attempt, maxAttempts, `rate limited, waiting ${countdown}`);
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
      let total: CompletionResult["tokenUsage"];
      let completeUsage = true;
      let malformedUsage = false;
      const account = (result: Pick<CompletionResult, "tokenUsage" | "usageStatus">) => {
        malformedUsage ||= result.usageStatus === "malformed" || result.usageStatus === "partial";
        completeUsage &&= result.usageStatus === "measured";
        if (result.tokenUsage) {
          total ??= { input: 0, output: 0, cacheReadInput: 0 };
          total.input += result.tokenUsage.input;
          total.output += result.tokenUsage.output;
          total.cacheReadInput = (total.cacheReadInput ?? 0) + (result.tokenUsage.cacheReadInput ?? 0);
        }
      };
      const accounting = () => ({ tokenUsage: total,
        usageStatus: total ? (completeUsage ? "measured" as const : "partial" as const)
          : malformedUsage ? "malformed" as const : "unavailable" as const });
      const attemptOnce = async (env: NodeJS.ProcessEnv) => {
        try {
          const result = await spawnOnce(cliBinary, finalRequest, env, options.codexConfig, options.policy);
          account(result);
          return { ...result, ...accounting() };
        } catch (error) {
          account(error instanceof Error ? error as ClaudeClientError : {});
          if (error instanceof Error) Object.assign(error, accounting());
          throw error;
        }
      };
      const cliEnv = resolveVendorCliEnv({ vendor: "codex", codex: options.codexConfig });
      const finalRequest: CompletionRequest = {
        ...request,
        model: request.model || defaultModel,
      };
      let attemptedWithoutApiKey = false;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        debugLog(`complete attempt=${attempt + 1}/${maxRetries + 1} model="${finalRequest.model}"`);
        try {
          return await attemptOnce(cliEnv);
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
            const env = { ...cliEnv };
            delete env.OPENAI_API_KEY;
            try {
              return await attemptOnce(env);
            } catch (retryErr) {
              lastError = retryErr as Error;
              debugLog(`retry without OPENAI_API_KEY failed: ${(retryErr as Error).message}`);
            }
          }

          if (err instanceof ClaudeClientError && !err.retryable) {
            debugLog("non-retryable error; aborting retries");
            throw Object.assign(lastError ?? err, accounting());
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
        throw Object.assign(new ClaudeClientError(
          `Codex rate limit exceeded — all ${maxRetries + 1} attempts failed. ` +
          "Wait a few minutes and try again, or reduce request frequency.",
          "rate-limit",
          false,
        ), accounting());
      }

      throw lastError;
    },
  };
}
