import { PROJECT_DIRS } from "../prd/llm-gateway.js";
export type { MemoryThrottleConfig } from "../process/memory-throttle.js";
export type { MemoryMonitorConfig } from "../process/memory-monitor.js";
export type { RuntimePoolConfig } from "../process/pool.js";
import type { MemoryThrottleConfig } from "../process/memory-throttle.js";
import type { MemoryMonitorConfig } from "../process/memory-monitor.js";
import type { RuntimePoolConfig } from "../process/pool.js";

export const HENCH_SCHEMA_VERSION = "hench/v1";

/**
 * Supported project languages for language-aware guard configuration.
 * "auto" triggers detection during `hench init`.
 */
export type ProjectLanguage = "typescript" | "javascript" | "go" | "swift";

/**
 * Configurable subset of policy limits (all optional, defaults applied at runtime).
 *
 * Defined here (schema) rather than in guard/contracts so that schema/v1
 * stays self-contained and guard stays free of schema imports.  The two
 * definitions are structurally identical; TypeScript's structural typing
 * ensures they remain compatible wherever HenchConfig.guard is passed to
 * GuardRails (which accepts the guard-owned GuardConfig interface).
 */
export interface PolicyLimitsConfig {
  /** Maximum commands per minute (0 = unlimited). */
  maxCommandsPerMinute?: number;
  /** Maximum file writes per minute (0 = unlimited). */
  maxWritesPerMinute?: number;
  /** Maximum total bytes written in the session (0 = unlimited). */
  maxTotalBytesWritten?: number;
  /** Maximum total commands in the session (0 = unlimited). */
  maxTotalCommands?: number;
}

/**
 * Security guard configuration embedded in {@link HenchConfig}.
 *
 * Defined here (schema) rather than in guard/contracts so that schema/v1
 * stays self-contained and guard stays free of schema imports.  The two
 * definitions are structurally identical; TypeScript's structural typing
 * ensures they remain compatible wherever HenchConfig.guard is passed to
 * GuardRails (which accepts the guard-owned GuardConfig interface).
 */
export interface GuardConfig {
  blockedPaths: string[];
  allowedCommands: string[];
  commandTimeout: number;
  maxFileSize: number;
  /** Timeout in ms for spawn-based execution (spawnTool/spawnManaged). 0 = no timeout. */
  spawnTimeout: number;
  /** Maximum concurrent child processes allowed. */
  maxConcurrentProcesses: number;
  /** Allowed git subcommands. Centralizes the git safety allowlist in guard config. */
  allowedGitSubcommands: string[];
  /** Policy limits for session-aware rate limiting and resource tracking. */
  policy?: PolicyLimitsConfig;
  /** Memory-based execution throttling configuration. */
  memoryThrottle?: Partial<MemoryThrottleConfig>;
  /** Pre-spawn memory monitoring configuration. */
  memoryMonitor?: Partial<MemoryMonitorConfig>;
  /** Runtime process pool configuration for warm worker reuse. */
  pool?: Partial<RuntimePoolConfig>;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Git-safety configuration embedded in {@link HenchConfig}.
 *
 * Governs how checkpoint decisions (currently the pre-run commit gate) react
 * to uncommitted changes in the working tree. Persisted in
 * `.hench/config.json` and editable via `n-dx config hench.git.*`.
 */
export interface GitSafetyConfig {
  /**
   * Lines-changed threshold (insertions + deletions vs HEAD) at or above
   * which the pre-run commit gate escalates: interactive prompts warn about
   * the change size and default to committing instead of proceeding.
   * Below the threshold, behavior is unchanged. 0 disables escalation.
   * Default: {@link DEFAULT_CHECKPOINT_THRESHOLD}.
   */
  checkpointThreshold?: number;
  /**
   * When true, runs refuse to start against a dirty working tree: the
   * interactive gate drops the "proceed" option (commit or stop only) and
   * non-interactive runs (--yes, piped, autonomous) abort. The
   * `--allow-dirty` CLI flag always overrides this setting for a single
   * run. Default: false.
   */
  requireCleanTree?: boolean;
}

/**
 * Default {@link GitSafetyConfig.checkpointThreshold}: escalate the pre-run
 * gate when uncommitted changes reach 200 changed lines.
 */
export const DEFAULT_CHECKPOINT_THRESHOLD = 200;

export type Provider = "cli" | "api";

/**
 * Permission posture for the spawned Claude CLI session.
 *
 * Maps directly to Claude CLI's `--permission-mode` flag values.
 * Only meaningful when `provider === "cli"` and the active vendor is Claude;
 * Codex ignores it.
 */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

/** All four valid PermissionMode values, in stable order for validation/UX. */
export const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

export interface HenchConfig {
  schema: string;
  provider: Provider;
  model: string;
  maxTurns: number;
  maxTokens: number;
  /** Total token budget per run (input + output). 0 = unlimited. */
  tokenBudget: number;
  rexDir: string;
  apiKeyEnv: string;
  guard: GuardConfig;
  retry: RetryConfig;
  loopPauseMs: number;
  maxFailedAttempts: number;
  /** When true, the agent is running in self-heal mode (structural fixes). */
  selfHeal?: boolean;
  /** Detected project language. Drives guard defaults during init. */
  language?: ProjectLanguage;
  /**
   * When true, the CLI loop uses EventAccumulator for result accumulation
   * instead of inline SpawnResult mutation. Spin detection and token budget
   * checks operate on the RuntimeEvent stream via the accumulator.
   *
   * This is a migration flag — both paths produce equivalent run records.
   * Will be removed once the event pipeline is validated in production.
   */
  useEventPipeline?: boolean;
  /**
   * When true, the API loop resolves the LLM provider via ProviderRegistry
   * instead of a hardcoded Claude vendor check. Enables registry-based
   * provider resolution for future multi-vendor API support.
   *
   * This is a migration flag — both paths produce identical results for
   * Claude. Will be removed once the registry path is validated.
   */
  useRegistryProvider?: boolean;
  /** Discovered claude CLI path, persisted by ndx init to avoid re-discovery on every run. */
  claudePath?: string;
  /**
   * Offer to revert uncommitted file changes when a run fails. Default: true.
   * The revert is prompt-only — it never runs without an interactive
   * confirmation, so non-interactive/autonomous/--yes runs never revert.
   * Set to false to suppress the prompt entirely (equivalent to --no-rollback).
   * The --no-rollback CLI flag always overrides this setting for a single run.
   */
  rollbackOnFailure?: boolean;
  /**
   * When true, the agent performs `git commit` itself at the end of the run
   * (legacy behavior — Claude CLI does this by default when the prompt tells
   * it to commit). When false (default), the agent stages changes and writes
   * its proposed commit message to `.hench-commit-msg.txt`; n-dx then prompts
   * the user to approve the commit before running `git commit -F <file>`.
   */
  autoCommit?: boolean;
  /**
   * How task spawns relate to vendor sessions.
   *
   * - `"fork"` (default where supported) — run orientation once, then fork
   *   that session per task (`--resume <id> --fork-session`), so no task
   *   re-pays cold-start context or re-explores the repo.
   * - `"batch"` — execute up to {@link tasksPerSession} tasks in one session,
   *   feeding each next brief as a follow-up turn. Vendor-neutral.
   * - `"cold"` — a fresh spawn per task (the original behavior).
   *
   * Forking requires a CLI that can resume by session id (Claude today), so
   * other vendors and the API provider resolve to `"cold"` regardless. See
   * `resolveSessionStrategy` in `agent/lifecycle/session-cache.ts`.
   */
  sessionStrategy?: "fork" | "batch" | "cold";
  /**
   * Tasks executed per session under the `"batch"` strategy (default: 4).
   * Bounded deliberately — a longer shared session saves more cold starts
   * but accumulates cross-task context that can bleed between them.
   */
  tasksPerSession?: number;
  /**
   * How long a cached orientation session may be forked before it is
   * rebuilt, in hours (default: 24). The analysis fingerprint invalidates a
   * parent when the repo is re-analyzed; this bounds how stale an
   * orientation can get without one.
   */
  parentMaxAgeHours?: number;
  /**
   * Ceiling on vendor spawns for a single task (default: 8).
   *
   * Every spawn counts — the initial one, failure retries, plan-mode
   * re-spawns, and fallbacks — because the defect this bounds was
   * multiplication between independent allowances, not any single one being
   * too generous. Hitting the ceiling fails the task loudly with the
   * breakdown rather than continuing to spend.
   */
  maxSpawnsPerTask?: number;
  /**
   * When true, skip the mandatory full test suite gate before commit.
   * Default: false (gate is mandatory). The --skip-test-gate CLI flag sets this.
   * Test gate failure blocks commit unless this flag is set or user selects skip.
   */
  skipFullTestGate?: boolean;
  /**
   * Full test suite command for mandatory pre-commit gate.
   * Resolution precedence:
   * 1. .hench/config.json fullTestCommand field
   * 2. .n-dx.json hench.fullTestCommand field
   * 3. Auto-detect from package.json (test, test:all scripts)
   * 4. Interactive prompt (when none of above are available)
   * Example: "pnpm test" or "npm run test:all"
   */
  fullTestCommand?: string;
  /**
   * Maximum number of times to re-prompt the agent when it produces a plan
   * without executing code modifications (default: 2).
   * Set to 0 to disable plan-only detection and allow completion with plans only.
   * Applies to autonomous and pair-programming modes.
   */
  planOnlyMaxRetries?: number;
  /**
   * Permission posture for the spawned Claude CLI session.
   *
   * When set, hench passes `--permission-mode <value>` to the Claude CLI.
   * When omitted, hench picks a default at runtime: autonomous runs
   * (`--auto`/`--loop`/`--epic-by-epic`) default to `"acceptEdits"` so the
   * agent can drive edits to completion without waiting on plan-mode
   * approval; interactive one-shot runs leave the flag off so Claude CLI
   * uses its built-in `default` mode and the user approves each tool.
   *
   * Only meaningful when `provider === "cli"` and the active vendor is
   * Claude — Codex ignores the field.
   */
  permissionMode?: PermissionMode;
  /**
   * Milliseconds to wait after `.hench-commit-msg.txt` is first detected with
   * non-empty content before automatically committing staged changes.
   *
   * This is a safety net for runs that terminate abnormally (timeout, crash)
   * after the agent has staged its work but before n-dx processes the commit
   * prompt. Set to 0 to disable auto-commit entirely. Default: 300000 (5 min).
   */
  commitMsgTimeoutMs?: number;
  /**
   * Git-safety settings for checkpoint decisions (pre-run commit gate).
   * See {@link GitSafetyConfig} for field semantics and defaults.
   */
  git?: GitSafetyConfig;
}

// ── Language-specific guard defaults ──────────────────────────────────

/** Guard defaults for JS/TS projects (the existing default). */
const JS_TS_GUARD_DEFAULTS: GuardConfig = {
  blockedPaths: [`${PROJECT_DIRS.HENCH}/**`, `${PROJECT_DIRS.REX}/**`, ".git/**", "node_modules/**"],
  allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
  commandTimeout: 30000,
  maxFileSize: 1048576,
  spawnTimeout: 300000,          // 5 minutes
  maxConcurrentProcesses: 3,
  allowedGitSubcommands: [
    "status", "add", "commit", "diff", "log",
    "branch", "checkout", "stash", "show", "rev-parse",
  ],
};

/** Guard defaults for Go projects. */
const GO_GUARD_DEFAULTS: GuardConfig = {
  blockedPaths: [`${PROJECT_DIRS.HENCH}/**`, `${PROJECT_DIRS.REX}/**`, ".git/**", "vendor/**"],
  allowedCommands: ["go", "make", "git", "golangci-lint"],
  commandTimeout: 30000,
  maxFileSize: 1048576,
  spawnTimeout: 300000,          // 5 minutes
  maxConcurrentProcesses: 3,
  allowedGitSubcommands: [
    "status", "add", "commit", "diff", "log",
    "branch", "checkout", "stash", "show", "rev-parse",
  ],
};

/**
 * Guard defaults for Swift projects (SwiftPM / Xcode).
 *
 * `swift` covers `swift build`, `swift test`, `swift package …`. `make` is
 * included because Swift app codebases very commonly wrap their full build +
 * test + lint gate in a Makefile target (e.g. `make validate`). `xcodebuild`
 * + `xcrun` cover Xcode-driven builds and CLI tools. `.build/` (SPM build
 * cache) and `DerivedData/` (Xcode build cache) are blocked so the agent
 * can't pollute or trip on them.
 */
const SWIFT_GUARD_DEFAULTS: GuardConfig = {
  blockedPaths: [
    `${PROJECT_DIRS.HENCH}/**`,
    `${PROJECT_DIRS.REX}/**`,
    ".git/**",
    ".build/**",
    "DerivedData/**",
    "Pods/**",
    "Carthage/**",
  ],
  allowedCommands: ["swift", "make", "xcodebuild", "xcrun", "git"],
  commandTimeout: 60000,           // Swift builds are slower than `go test` — 60s.
  maxFileSize: 1048576,
  spawnTimeout: 600000,            // 10 minutes — Xcode builds can run long.
  maxConcurrentProcesses: 3,
  allowedGitSubcommands: [
    "status", "add", "commit", "diff", "log",
    "branch", "checkout", "stash", "show", "rev-parse",
  ],
};

/**
 * Returns the language-appropriate guard defaults.
 * Falls back to JS/TS defaults for unknown languages.
 */
export function guardDefaultsForLanguage(language?: ProjectLanguage): GuardConfig {
  if (language === "go") return { ...GO_GUARD_DEFAULTS };
  if (language === "swift") return { ...SWIFT_GUARD_DEFAULTS };
  return { ...JS_TS_GUARD_DEFAULTS };
}

/**
 * Default hench configuration. When `language` is provided, guard defaults
 * are tuned for that language's toolchain. Omitting it preserves the
 * existing JS/TS defaults for backward compatibility.
 */
export function DEFAULT_HENCH_CONFIG(language?: ProjectLanguage): HenchConfig {
  return {
    schema: HENCH_SCHEMA_VERSION,
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: PROJECT_DIRS.REX,
    apiKeyEnv: "ANTHROPIC_API_KEY",
    guard: guardDefaultsForLanguage(language),
    retry: {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
    },
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
    autoCommit: false,
    planOnlyMaxRetries: 2,
    ...(language ? { language } : {}),
  };
}

export type RunStatus = "running" | "completed" | "failed" | "timeout" | "budget_exceeded" | "error_transient" | "cancelled";

export interface ToolCallRecord {
  turn: number;
  tool: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
}

/**
 * Normalized per-run token totals suitable for PRD rollup.
 *
 * Derived from {@link TokenUsage} via {@link normalizeRunTokens}. Stored on
 * every {@link RunRecord} so that downstream consumers (dashboards, rollup
 * queries) can join runs to PRD items by `taskId` without re-parsing
 * transcripts or re-deriving cache accounting on every read.
 *
 * - `input`  — uncached input tokens
 * - `output` — completion tokens
 * - `cached` — cache-write + cache-read tokens (combined)
 * - `total`  — sum of the three fields above
 */
export interface RunTokens {
  input: number;
  output: number;
  cached: number;
  total: number;
}

/**
 * Normalize a {@link TokenUsage} into the PRD-rollup shape.
 *
 * Accepts `undefined` (and missing cache fields) so it can be called
 * unconditionally at save time — aborted, failed, and zero-usage runs
 * all produce a valid tuple with the correct zeros.
 */
export function normalizeRunTokens(usage: TokenUsage | undefined): RunTokens {
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const cached = (usage?.cacheCreationInput ?? 0) + (usage?.cacheReadInput ?? 0);
  return { input, output, cached, total: input + output + cached };
}

/** Token usage for a single API turn. */
export interface TurnTokenUsage {
  turn: number;
  input: number;
  output: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
  /** LLM vendor used for this token event (e.g. "claude", "codex"). */
  vendor?: string;
  /** Model used for this token event. */
  model?: string;
  /**
   * Diagnostic status of token usage data for this turn.
   * - `complete` — both input and output fields were present and numeric
   * - `partial` — only one of input/output was present; the other was backfilled to 0
   * - `unavailable` — neither field was present; values are synthetic zeros
   */
  diagnosticStatus?: "complete" | "partial" | "unavailable";
}

/**
 * Diagnostic metadata for a single prompt section.
 *
 * Captured at prompt construction time and stored on the run record
 * so post-hoc analysis can verify prompt composition without replaying
 * the full prompt text.
 */
export interface PromptSectionDiagnostic {
  /** Section name (e.g. "system", "brief", "workflow"). */
  name: string;
  /** Byte length of the section content (UTF-8). */
  byteLength: number;
}

/**
 * Run-level diagnostics captured during execution.
 *
 * Provides observability into how token usage was parsed and whether
 * the data is trustworthy. Stored on the run record so that post-hoc
 * analysis can distinguish "vendor returned zeros" from "vendor omitted
 * usage data and we backfilled zeros".
 */
export interface RunDiagnostics {
  /**
   * Overall token diagnostic status for the run.
   * Derived from per-turn diagnostic statuses:
   * - `complete` — all turns reported complete token data
   * - `partial` — at least one turn had partial data
   * - `unavailable` — at least one turn had no token data
   */
  tokenDiagnosticStatus: "complete" | "partial" | "unavailable";
  /** Output parse mode used by the vendor wrapper (e.g. "stream-json", "json", "api-sdk"). */
  parseMode: string;
  /** Vendor-specific diagnostic notes (e.g. "codex_usage_missing"). */
  notes: string[];
  /**
   * Prompt section diagnostics from the initial prompt envelope.
   *
   * Captures the name and byte size of each section assembled into
   * the prompt, enabling observability into prompt composition without
   * storing the full prompt text.
   */
  promptSections?: PromptSectionDiagnostic[];

  // ── Runtime identity fields (captured at run start) ───────────────

  /**
   * LLM vendor active for this run (e.g. "claude", "codex").
   *
   * v1 additive field — old records without this field load normally.
   */
  vendor?: string;
  /**
   * Sandbox mode in effect (e.g. "workspace-write", "read-only").
   *
   * v1 additive field — old records without this field load normally.
   */
  sandbox?: string;
  /**
   * Approval policy in effect (e.g. "never", "on-request").
   *
   * v1 additive field — old records without this field load normally.
   */
  approvals?: string;
}

/**
 * Serializable representation of a RuntimeEvent for persistence.
 *
 * Mirrors the `RuntimeEvent` contract from `@n-dx/llm-client` but uses
 * plain (non-readonly) fields so that the type is JSON-serializable and
 * Zod-validatable. Stored on `RunRecord.events` when verbose/debug mode
 * is enabled.
 */
export interface PersistedRuntimeEvent {
  /** Event type. */
  type: string;
  /** Which vendor produced this event. */
  vendor: string;
  /** Monotonically increasing turn number (1-based). */
  turn: number;
  /** ISO 8601 timestamp when the event was received. */
  timestamp: string;

  // ── Type-specific payloads (only one is set per event) ──

  /** Assistant message text (type: "assistant"). */
  text?: string;

  /** Tool invocation details (type: "tool_use"). */
  toolCall?: {
    tool: string;
    input: Record<string, unknown>;
  };

  /** Tool execution result (type: "tool_result"). */
  toolResult?: {
    tool: string;
    output: string;
    durationMs: number;
  };

  /** Token usage for this turn or cumulative (type: "token_usage"). */
  tokenUsage?: TokenUsage;

  /** Failure details (type: "failure"). */
  failure?: {
    category: string;
    message: string;
    vendorDetail?: string;
  };

  /** Completion summary text (type: "completion"). */
  completionSummary?: string;
}

export interface CommandRecord {
  command: string;
  exitStatus: "ok" | "error" | "timeout" | "blocked";
  durationMs: number;
}

export interface TestRecord {
  command: string;
  passed: boolean;
  durationMs: number;
}

export interface SummaryCounts {
  filesRead: number;
  filesChanged: number;
  commandsExecuted: number;
  testsRun: number;
  toolCallsTotal: number;
}

export interface PostRunTestRecord {
  /** Whether tests were executed. */
  ran: boolean;
  /** Whether all tests passed. */
  passed: boolean;
  /** The command that was executed. */
  command?: string;
  /** Human-readable test output (truncated). */
  output?: string;
  /** Duration in ms. */
  durationMs?: number;
  /** Test files that were specifically targeted. Empty if full suite. */
  targetedFiles: string[];
  /** Error message if tests couldn't be run. */
  error?: string;
}

export interface RunSummaryData {
  filesChanged: string[];
  filesRead: string[];
  commandsExecuted: CommandRecord[];
  testsRun: TestRecord[];
  /** Automatic post-task test results. */
  postRunTests?: PostRunTestRecord;
  /**
   * Files changed with their git status codes (A/M/D/R/C/T).
   *
   * Populated from git diff-tree after commit. Format is "STATUS\tPATH"
   * matching git's output. Provides accurate tracking of what was actually
   * committed, replacing tool-call-based heuristics.
   *
   * v1 additive field — old records without this field load normally.
   */
  fileChangesWithStatus?: string[];
  counts: SummaryCounts;
}

export interface RunMemoryStats {
  /** Peak RSS of the hench process during this run (bytes). */
  peakRssBytes: number;
  /** System available memory at run start (bytes). -1 if unavailable. */
  systemAvailableAtStartBytes: number;
  /** System available memory at run end (bytes). -1 if unavailable. */
  systemAvailableAtEndBytes: number;
  /** System total memory (bytes). */
  systemTotalBytes: number;
}

export interface TestPackageResult {
  /** Package name/path (e.g., "packages/hench", "packages/rex") */
  name: string;
  /** Whether tests passed for this package */
  passed: boolean;
  /** Total number of tests run */
  testCount?: number;
  /** Number of failed tests */
  failureCount?: number;
  /** Abbreviated error output (last 500 chars) */
  failureOutput?: string;
  /** Elapsed time for this package (ms) */
  durationMs?: number;
}

/**
 * Outcome of the mandatory pre-commit test gate.
 *
 * Three outcomes, and `ran` is what distinguishes them — check it before
 * `passed`:
 *
 * - `ran: true`  — the suite executed. `passed` is a real verdict on the code.
 * - `ran: false` + `skipReason` — deliberately not run (e.g. no files changed).
 * - `ran: false` + `error` — INCONCLUSIVE. The gate could not be executed at
 *   all (the command could not be spawned). `passed` is meaningless here and is
 *   set false only because the field is required; treating it as a verdict
 *   reports "your tests failed" for a suite that never started.
 */
export interface TestGateResult {
  /** Whether the test gate ran at all. See the interface docblock — check this before `passed`. */
  ran: boolean;
  /** Overall pass/fail (all packages must pass). Only meaningful when `ran` is true. */
  passed: boolean;
  /** Per-package results */
  packages: TestPackageResult[];
  /** Reason gate was deliberately skipped, if applicable */
  skipReason?: string;
  /** The full pnpm test command executed */
  command?: string;
  /** Total elapsed time (ms) */
  totalDurationMs?: number;
  /** Why the gate could not produce a verdict (never launched, or timed out) */
  error?: string;
}

export interface DependencyVulnerability {
  /** Package name */
  name: string;
  /** Current version */
  version: string;
  /** Severity level */
  severity: "critical" | "high" | "moderate" | "low";
}

export interface DependencyOutdated {
  /** Package name */
  name: string;
  /** Current version */
  current: string;
  /** Latest available version */
  latest: string;
  /** Type of update: major, minor, or patch */
  type: "major" | "minor" | "patch";
}

export interface DependencyAuditPackageResult {
  /** Workspace package name or path */
  name: string;
  /** Number of vulnerabilities found */
  vulnerabilityCount: number;
  /** Number of outdated packages */
  outdatedCount: number;
}

/**
 * One `pnpm` invocation made by the dependency audit.
 *
 * `ran` is what separates "this step found nothing" from "this step could not
 * look". The two are otherwise identical: a step that never launched leaves
 * every count it feeds at zero, exactly like a step that ran and found nothing.
 */
export interface DependencyAuditCommandRecord {
  /** The command string executed. */
  command: string;
  /** Exit code, or null when the command was killed (timeout) or never spawned. */
  exitCode: number | null;
  /**
   * Whether this step produced counts that can be trusted.
   *
   * false means its contribution to the aggregate counts is zeros that carry no
   * information — not an absence of findings. `error` says why.
   *
   * Required rather than optional so every construction site has to state it.
   */
  ran: boolean;
  /** Why the step produced no counts. Present iff `ran` is false. */
  error?: string;
}

/**
 * Outcome of the pre-loop dependency audit (self-heal mode).
 *
 * Check `ran` before reading any count. Three outcomes:
 *
 * - `ran: true`, no `error` — both steps executed; the counts are real.
 * - `ran: true` + `error` — PARTIAL. One step executed, the other could not.
 *   The failed half contributed zeros that mean nothing; `commands` says which
 *   half and why.
 * - `ran: false` + `error` — INCONCLUSIVE. Neither step produced counts. Every
 *   count is zero and none of them means "clean".
 *
 * WHAT AN INCONCLUSIVE AUDIT MEANS FOR THE CALLER: warn and proceed. It does
 * not block the run. Three reasons, recorded because this is a security-adjacent
 * gate and the default instinct is to fail closed:
 *
 * 1. The audit is advisory. No code path gates on its findings — a run with ten
 *    critical vulnerabilities proceeds today. A step that could not launch must
 *    not be treated more harshly than one that launched and found those ten.
 * 2. The defect this shape exists to prevent is the opposite one: reporting "no
 *    vulnerabilities found" for an audit that never ran. That is fixed by never
 *    claiming a clean result, not by stopping the run.
 * 3. Blocking would turn a local tooling gap (`pnpm` absent from PATH, no
 *    lockfile) into a total work stoppage, on exactly the platforms where spawn
 *    failures are common.
 *
 * If the audit is ever promoted to a gate that can fail a run, revisit the
 * decision THERE, not here: the inconclusive state is already distinguishable,
 * so such a gate can fail closed without a schema change.
 */
export interface DependencyAuditResult {
  /**
   * Whether the audit produced any trustworthy counts at all.
   *
   * See the interface docblock — check this, and `error`, before reading a
   * count. false with all-zero counts is "could not look", not "nothing found".
   */
  ran: boolean;
  /** Whether the audit was skipped */
  skipped: boolean;
  /** Reason audit was skipped if applicable */
  skipReason?: string;
  /** ISO timestamp when audit started */
  startedAt: string;
  /** ISO timestamp when audit finished */
  finishedAt: string;
  /** Total elapsed time (ms) */
  totalDurationMs: number;
  /** Aggregated vulnerability counts by severity */
  vulnerabilities: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    packages: DependencyVulnerability[];
  };
  /** Aggregated outdated package counts by update type */
  outdated: {
    major: string[];
    minor: string[];
    patch: string[];
  };
  /** Per-workspace-package results */
  perPackage: DependencyAuditPackageResult[];
  /** Per-step records — which command ran, and why one did not. */
  commands?: {
    audit?: DependencyAuditCommandRecord;
    outdated?: DependencyAuditCommandRecord;
  };
  /**
   * Why the audit is inconclusive or partial. Present iff at least one step
   * failed to produce counts; see the interface docblock for how to read it
   * together with `ran`.
   */
  error?: string;
}

export interface CleanupTransformationRecord {
  /** Type of transformation applied. */
  type: "dead_export_removal" | "unused_import_prune" | "utility_consolidation";
  /** File path (relative to project root). */
  file: string;
  /** Start line (1-indexed). */
  startLine: number;
  /** End line (1-indexed). */
  endLine: number;
  /** Human-readable description. */
  description: string;
  /** The removed/modified code snippet. */
  removedCode?: string;
}

export interface CleanupBatchRecord {
  /** Transformations in this batch. */
  transformations: CleanupTransformationRecord[];
  /** Whether tsc validated the batch. */
  validated: boolean;
  /** Whether the batch was rolled back. */
  rolledBack: boolean;
  /** Error message if validation failed. */
  error?: string;
}

export interface CleanupTransformationResult {
  /** Whether cleanup ran at all */
  ran: boolean;
  /** Number of transformations successfully applied */
  appliedCount: number;
  /** Number of transformations rolled back due to validation failure */
  rolledBackCount: number;
  /** All transformation batches (for logging) */
  batches: CleanupBatchRecord[];
  /** Total elapsed time (ms) */
  totalDurationMs: number;
  /** Error if cleanup itself failed */
  error?: string;
}

/**
 * What the adversarial review pass did, recorded on the run it reviewed.
 *
 * A discriminated pair of shapes rather than one shape with optional fields:
 * a failed review has no finding counts, and a successful one has no failure
 * reason. Collapsing them would make `findingCount: 0` ambiguous between "the
 * attack found nothing" and "the reviewer never ran".
 */
export type RunReviewRecord =
  | {
      /** Model the reviewer ran on. Empty for the local vendor. */
      model: string;
      /** True when the reviewer resumed the work session rather than starting fresh. */
      resumedSession: boolean;
      /** Findings surviving both passes, including the ones deliberately dropped. */
      findingCount: number;
      /**
       * Findings left unresolved for either reason — the sum of the two counts
       * below. Not a must-fix count: it also carries findings below must-fix
       * whose action failed. Kept as the single "needs a look" headline.
       */
      unresolvedCount: number;
      /**
       * Must-fix findings the pass could not repair. Non-zero means a defect
       * is still in the tree and needs a human.
       */
      unrepairedMustFixCount: number;
      /**
       * Findings below must-fix whose action failed (e.g. the PRD capture
       * threw). The code is fine; the record of it is not. A failed must-fix
       * counts under `unrepairedMustFixCount`, never here.
       */
      failedActionCount: number;
      /** True when the reviewer edited a file. */
      fixesApplied: boolean;
      /** Absolute path of the JSON report the reviewer wrote. */
      reportPath: string;
      /**
       * Repo-relative paths the review pass changed, computed from
       * working-tree snapshots taken around the reviewer spawn. Excludes
       * `.rex/` (committed as completion metadata) and `.hench/` (the report
       * itself). Absent when the snapshot could not be taken.
       */
      repairedFiles?: string[];
      /** Commit that captured the repairs on the autoCommit path. */
      repairCommit?: string;
      failed?: undefined;
    }
  | {
      /** Why the pass produced no usable report. */
      failed: string;
      /** Human-readable detail for the failure. */
      detail: string;
    };

export interface RunRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
  finishedAt?: string;
  /** ISO timestamp of the most recent agent activity. Updated on every periodic save. */
  lastActivityAt?: string;
  status: RunStatus;
  turns: number;
  summary?: string;
  error?: string;
  tokenUsage: TokenUsage;
  /**
   * Normalized per-run token totals used for PRD rollup.
   *
   * Populated automatically by `saveRun()` from {@link tokenUsage} on every
   * write, including aborted/failed runs — so downstream rollups can
   * `{ itemId: taskId, tokens }`-join to the PRD without undercounting.
   *
   * Optional on read for backward compatibility with legacy run files; new
   * writes always include it.
   */
  tokens?: RunTokens;
  /** Per-turn token breakdown. One entry per API call. */
  turnTokenUsage?: TurnTokenUsage[];
  toolCalls: ToolCallRecord[];
  model: string;
  /**
   * LLM vendor used for this run ("claude" | "codex").
   * Also available via `diagnostics.vendor` but captured here for easy commit-time access.
   * v1 additive field — old records without this field load normally.
   */
  vendor?: string;
  /**
   * Task weight / tier selected for this run ("light" | "standard").
   * Used for task-weight tiering to select cheaper models for simple tasks.
   * Defaults to "standard" if not specified.
   * v1 additive field — old records without this field load normally.
   */
  weight?: string;
  /**
   * Orientation session this run's task spawn was forked from, when the
   * warm-parent strategy was active. Its presence is what makes the saving
   * auditable: a run with a parent paid no cold start, one without spawned
   * cold. v1 additive field.
   */
  parentSessionId?: string;
  /**
   * Total vendor spawns this task made, including retries, plan-mode
   * re-spawns, and fallbacks. Recorded so `ndx usage` can report retry
   * overhead: a task that cost four spawns to complete is a different story
   * from one that cost one. v1 additive field.
   */
  spawnCount?: number;
  /**
   * Spawns by reason, so the same total can be told apart — six plan-mode
   * re-spawns and six failure retries call for entirely different fixes.
   * v1 additive field.
   */
  spawnBreakdown?: Record<string, number>;
  retryAttempts?: number;
  /** Structured metadata derived from tool calls at run finalization. */
  structuredSummary?: RunSummaryData;
  /** Memory usage statistics captured during the run. */
  memoryStats?: RunMemoryStats;
  /** Full test suite gate results (self-heal mode only). */
  testGate?: TestGateResult;
  /** Dependency audit results (self-heal mode only). */
  dependencyAudit?: DependencyAuditResult;
  /** Cleanup transformation results (self-heal mode only). */
  cleanupTransformations?: CleanupTransformationResult;
  /** Run-level diagnostics for token parsing and vendor observability. */
  diagnostics?: RunDiagnostics;
  /**
   * Outcome of the adversarial review pass (`ndx work --review`).
   *
   * Absent when `--review` was not passed. Present-and-failed is a distinct,
   * meaningful state: a review that could not run must not be readable as a
   * review that found nothing, and the terminal output where the warning was
   * printed does not survive the session.
   *
   * v1 additive field — records without it load normally.
   */
  review?: RunReviewRecord;
  /**
   * Full RuntimeEvent stream captured during the run.
   *
   * Only populated when verbose/debug mode is enabled (to avoid bloating
   * run records during normal operation). Useful for post-hoc debugging
   * and event pipeline analysis.
   *
   * v1 additive field — no migration needed. Existing records without
   * this field load normally.
   */
  events?: PersistedRuntimeEvent[];
  /**
   * Context in which hench was invoked ("cli" for CLI invocation, "api" for HTTP/MCP).
   *
   * v1 additive field — no migration needed. Existing records without
   * this field load normally.
   */
  invocationContext?: "cli" | "api";
  /**
   * True when the record was written by an assisted execution path (a skill
   * driving the work through Claude Code) rather than by a spawned hench agent.
   *
   * Assisted runs DO carry token usage: Claude Code does not hand a skill its
   * counts, but it writes them to the session transcript, which `hench record`
   * reads (see `store/session-usage.ts`). The flag therefore marks provenance —
   * assisted vs agent — not the absence of usage. It stays useful for exactly
   * that: `turns` and `toolCalls` are thin on these records, so analytics that
   * expect per-turn detail should branch on it.
   *
   * A 0-token assisted record is still possible and still valid — no transcript
   * was found, or `--no-tokens` was passed — and is not an anomaly.
   *
   * v1 additive field — old records without this field load normally.
   */
  assisted?: boolean;
  /**
   * Actor identity that started this run, e.g. `"Jane Doe <jane@example.com>"`.
   * Resolved from git `user.name`/`user.email`, falling back to the OS
   * username, then `"unknown"`. See `process/actor-identity.ts`.
   *
   * v1 additive field — old records without this field load normally.
   */
  actor?: string;
  /**
   * Host name the run executed on (`os.hostname()`).
   *
   * v1 additive field — old records without this field load normally.
   */
  host?: string;
}

export interface TaskBriefTask {
  id: string;
  title: string;
  level: string;
  status: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
  blockedBy?: string[];
  failureReason?: string;
}

export interface TaskBriefParent {
  id: string;
  title: string;
  level: string;
  description?: string;
}

export interface TaskBriefSibling {
  id: string;
  title: string;
  status: string;
}

export interface TaskBriefProject {
  name: string;
  validateCommand?: string;
  testCommand?: string;
  /**
   * The project's resolved CLI command name (`cli.name` from `.n-dx.json`,
   * default "n-dx"). Injected into system prompts and task briefs so agents
   * reference the correct command in generated code, docs, and instructions.
   */
  cliName?: string;
}

export interface TaskBriefLogEntry {
  timestamp: string;
  event: string;
  detail?: string;
}

/**
 * A requirement included in the task brief for agent awareness.
 */
export interface TaskBriefRequirement {
  id: string;
  title: string;
  category: string;
  validationType: string;
  acceptanceCriteria: string[];
  /** Where this requirement was defined (item title). */
  source: string;
}

export interface TaskBrief {
  task: TaskBriefTask;
  parentChain: TaskBriefParent[];
  siblings: TaskBriefSibling[];
  /** Requirements that apply to this task (own + inherited). */
  requirements: TaskBriefRequirement[];
  project: TaskBriefProject;
  workflow: string;
  recentLog: TaskBriefLogEntry[];
  /**
   * Active session-level filters applied during task selection.
   * Present when the caller restricted selection (e.g. self-heal tag filter).
   */
  sessionFilters?: {
    /** Only tasks with at least one of these tags were eligible for selection. */
    tags?: string[];
  };
}
