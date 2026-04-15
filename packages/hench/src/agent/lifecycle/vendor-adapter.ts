/**
 * VendorAdapter interface and SpawnConfig type.
 *
 * Defines the contract that vendor-specific adapter modules (ClaudeCliAdapter,
 * CodexCliAdapter) must implement. This interface replaces the ad hoc
 * `dispatchVendorSpawn` switch in `cli-loop.ts` with a pluggable adapter
 * pattern.
 *
 * ## Contract areas
 *
 * 1. **SpawnConfig** — All data needed to spawn a vendor CLI process:
 *    binary path, arguments, environment, optional stdin, working directory.
 *
 * 2. **VendorAdapter** — Four-method interface that each vendor implements:
 *    - `buildSpawnConfig` — Translate a PromptEnvelope + policy into spawn args
 *    - `parseEvent` — Parse a single stdout/stderr line into a RuntimeEvent
 *    - `classifyError` — Map an error to the shared FailureCategory taxonomy
 *    - `vendor` / `parseMode` — Read-only identification properties
 *
 * ## Architectural role
 *
 * Lives in the execution layer (`hench/src/agent/lifecycle/`). Consumes
 * foundation-layer types from `@n-dx/llm-client` via `llm-gateway.ts`.
 * Consumed by `cli-loop.ts` for adapter-based dispatch.
 *
 * @see packages/llm-client/src/runtime-contract.ts — source of RuntimeEvent, FailureCategory, etc.
 * @see docs/architecture/phase2-vendor-normalization.md — design rationale
 */

import type { LLMVendor } from "../../prd/llm-gateway.js";
import type {
  PromptEnvelope,
  ExecutionPolicy,
  RuntimeEvent,
  FailureCategory,
} from "../../prd/llm-gateway.js";

// ── SpawnConfig ──────────────────────────────────────────────────────────

/**
 * Configuration needed to spawn a vendor CLI subprocess.
 *
 * Captures everything `child_process.spawn()` needs in a vendor-neutral
 * shape. Each adapter's `buildSpawnConfig` method produces one of these.
 *
 * Design notes:
 * - `stdinContent` is `string | null` rather than `string | undefined`
 *   because the distinction is semantically meaningful:
 *   - `string` → write to stdin then close (Claude: pipe-based prompt delivery)
 *   - `null` → do not write to stdin; use `"ignore"` stdio (Codex: prompt in args)
 * - `env` is a plain record rather than `NodeJS.ProcessEnv` so the type
 *   is portable and doesn't depend on Node.js typings.
 */
export interface SpawnConfig {
  /** Path to the vendor CLI binary (e.g. "claude", "codex", or absolute path). */
  readonly binary: string;

  /** CLI arguments passed to the spawned process. */
  readonly args: readonly string[];

  /** Environment variables for the spawned process. */
  readonly env: Readonly<Record<string, string | undefined>>;

  /**
   * Content to write to the process's stdin, or `null` if stdin is not used.
   *
   * - Claude: prompt text (and optionally system prompt on Windows) written to stdin
   * - Codex: `null` — prompt is passed as a positional argument
   */
  readonly stdinContent: string | null;

  /** Working directory for the spawned process. */
  readonly cwd: string;
}

// ── VendorAdapter ────────────────────────────────────────────────────────

/**
 * Adapter interface for vendor-specific CLI execution.
 *
 * Each LLM vendor (Claude, Codex, future providers) implements this
 * interface to encapsulate:
 * - How a PromptEnvelope is compiled into CLI spawn arguments
 * - How stdout/stderr lines are parsed into normalized RuntimeEvents
 * - How errors are classified into the shared FailureCategory taxonomy
 *
 * The adapter pattern replaces the vendor-specific branching in
 * `cli-loop.ts`'s `dispatchVendorSpawn` function, making the vendor
 * surface pluggable and independently testable.
 */
export interface VendorAdapter {
  /** Which LLM vendor this adapter handles. */
  readonly vendor: LLMVendor;

  /**
   * Output parse mode identifier.
   *
   * Recorded in {@link RuntimeDiagnostics} for observability. Each vendor
   * uses a different output format:
   * - Claude: `"stream-json"` (newline-delimited JSON stream)
   * - Codex: `"json"` (JSONL events)
   */
  readonly parseMode: string;

  /**
   * Build the spawn configuration for a vendor CLI invocation.
   *
   * Translates the vendor-neutral PromptEnvelope and ExecutionPolicy
   * into the vendor-specific binary, arguments, environment, and stdin
   * content needed by `child_process.spawn()`.
   *
   * @param envelope - Structured prompt with named sections
   * @param policy - Execution policy (sandbox, approvals, allowed tools)
   * @param model - Optional model override (e.g. "claude-sonnet-4-20250514", "gpt-5-codex")
   * @returns SpawnConfig ready for process creation
   */
  buildSpawnConfig(
    envelope: PromptEnvelope,
    policy: ExecutionPolicy,
    model: string | undefined,
  ): SpawnConfig;

  /**
   * Parse a single line of vendor CLI output into a RuntimeEvent.
   *
   * Called for each newline-delimited line from stdout (and potentially
   * stderr). Returns `null` for lines that don't represent a meaningful
   * event (e.g. progress indicators, empty lines).
   *
   * @param line - A single line from the CLI process output
   * @param turn - Current turn number (1-based, monotonically increasing)
   * @param metadata - Additional context for parsing (e.g. model name, vendor config)
   * @returns A normalized RuntimeEvent, or `null` if the line is not an event
   */
  parseEvent(
    line: string,
    turn: number,
    metadata: Record<string, unknown>,
  ): RuntimeEvent | null;

  /**
   * Classify an error into the shared failure taxonomy.
   *
   * Maps vendor-specific error objects, exit codes, and error messages
   * into the normalized {@link FailureCategory} so run evaluation and
   * PRD status updates work identically regardless of vendor.
   *
   * @param err - The error to classify (may be Error, string, or unknown)
   * @returns The appropriate FailureCategory
   */
  classifyError(err: unknown): FailureCategory;
}
