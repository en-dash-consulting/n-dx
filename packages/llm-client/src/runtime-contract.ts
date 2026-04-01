/**
 * Normalized Claude/Codex runtime contract.
 *
 * This module defines the shared runtime contract that both vendor wrappers
 * (Claude and Codex) compile from. It replaces ad hoc defaults scattered
 * across `cli-loop.ts`, `codex-cli-provider.ts`, and `run.ts` with one
 * canonical set of types and defaults.
 *
 * ## Contract areas
 *
 * 1. **Prompt envelope** — Named sections that compose the LLM prompt.
 *    Both vendors receive the same logical content; delivery channel differs
 *    (Claude: separate `--system-prompt` flag; Codex: combined positional arg).
 *
 * 2. **Execution policy** — Sandbox mode, approval policy, allowed tools and
 *    commands. One n-dx policy object compiles to vendor-specific CLI flags.
 *
 * 3. **Runtime event schema** — Vendor-neutral event types that both Claude
 *    stream-json events and Codex JSONL events normalize into.
 *
 * 4. **Failure taxonomy** — Shared failure categories so run evaluation
 *    classifies errors identically regardless of vendor.
 *
 * ## Architectural role
 *
 * Lives in the foundation layer (`@n-dx/llm-client`). Consumed by:
 * - `hench` via `llm-gateway.ts` (execution layer)
 * - vendor wrapper modules (Claude CLI, Codex CLI providers)
 *
 * No upstream imports — this module depends only on leaf types from
 * `types.ts` and `provider-interface.ts`.
 *
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md — design rationale
 * @see docs/process/codex-transport-artifact-decisions.md — locked decisions
 */

import type { LLMVendor } from "./provider-interface.js";
import type { TokenUsage, ErrorReason } from "./types.js";
import { ClaudeClientError } from "./types.js";

// ── Prompt envelope ──────────────────────────────────────────────────────

/**
 * Named section of a prompt envelope.
 *
 * Canonical sections (from the runtime identity discovery doc):
 * - `system` — role and identity instructions
 * - `workflow` — workflow constraints and rules
 * - `brief` — task brief content
 * - `files` — relevant file context
 * - `validation` — validation requirements
 * - `completion` — completion contract / done-when criteria
 *
 * The type is open (`string & {}`) so callers can add vendor-specific or
 * task-specific sections without modifying this module.
 */
export type PromptSectionName =
  | "system"
  | "workflow"
  | "brief"
  | "files"
  | "validation"
  | "completion"
  | (string & {});

/**
 * A single named section within a prompt envelope.
 *
 * Sections are ordered — the prompt is assembled by concatenating sections
 * in array order. Each section has a name (for identification and logging)
 * and content (the actual text).
 */
export interface PromptSection {
  /** Section identifier. Used for logging and vendor-specific routing. */
  readonly name: PromptSectionName;
  /** Section content. May be empty if the section is conditionally omitted. */
  readonly content: string;
}

/**
 * Structured prompt envelope delivered to both vendors.
 *
 * The envelope carries the same logical prompt content regardless of vendor.
 * Vendor wrappers translate this into their native delivery format:
 * - Claude: `--system-prompt` flag (system sections) + stdin (task sections)
 * - Codex: combined positional argument with `SYSTEM:\n...\nTASK:\n...`
 */
export interface PromptEnvelope {
  /** Ordered prompt sections. */
  readonly sections: ReadonlyArray<PromptSection>;
}

// ── Execution policy ─────────────────────────────────────────────────────

/**
 * Sandbox modes controlling file system and environment access.
 *
 * These map to vendor-specific CLI flags:
 * - Claude: permission rules (`allow`, `ask`, `deny`) per tool category
 * - Codex: `--sandbox` flag (`read-only`, `workspace-write`, `full-access`)
 */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/**
 * Approval policies controlling when the agent asks for human confirmation.
 *
 * - `on-request` — ask when crossing the normal boundary (interactive local use)
 * - `never` — fail deterministically instead of asking (unattended/CI execution)
 *
 * These map to vendor-specific CLI flags:
 * - Claude: `--allowed-tools` allowlist (tools not listed require approval)
 * - Codex: `--approval-policy` flag (`suggest`, `auto-edit`, `full-auto`)
 */
export type ApprovalPolicy = "on-request" | "never";

/**
 * Normalized execution policy for both vendors.
 *
 * One n-dx policy object compiles to vendor-specific CLI flags/config.
 * This replaces ad hoc `--full-auto` and `--allowed-tools` patterns.
 *
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md §7.1
 */
export interface ExecutionPolicy {
  /** File system access level. */
  readonly sandbox: SandboxMode;
  /** Human approval behavior. */
  readonly approvals: ApprovalPolicy;
  /** Whether outbound network access is permitted. */
  readonly networkAccess: boolean;
  /** Directories the agent may write to (relative to project root). */
  readonly writableRoots: ReadonlyArray<string>;
  /** Shell commands the agent may execute (e.g. `["npm", "git", "node"]`). */
  readonly allowedCommands: ReadonlyArray<string>;
  /** File operation tools the agent may use (e.g. `["Read", "Edit", "Write"]`). */
  readonly allowedFileTools: ReadonlyArray<string>;
}

// ── Runtime events ───────────────────────────────────────────────────────

/**
 * Vendor-neutral runtime event types.
 *
 * Both Claude stream-json events and Codex JSONL events normalize into
 * these categories. The shared schema lets hench classify runs consistently.
 */
export type RuntimeEventType =
  | "assistant"
  | "tool_use"
  | "tool_result"
  | "completion"
  | "failure"
  | "token_usage";

/**
 * A single vendor-neutral runtime event.
 *
 * Vendor wrappers parse their native event streams and emit these objects.
 * The `vendor` field records provenance; all other fields are identical
 * regardless of which vendor produced the event.
 */
export interface RuntimeEvent {
  /** Event type. */
  readonly type: RuntimeEventType;
  /** Which vendor produced this event. */
  readonly vendor: LLMVendor;
  /** Monotonically increasing turn number (1-based). */
  readonly turn: number;
  /** ISO 8601 timestamp when the event was received. */
  readonly timestamp: string;

  // ── Type-specific payloads (only one is set per event) ──

  /** Assistant message text (type: "assistant"). */
  readonly text?: string;

  /** Tool invocation details (type: "tool_use"). */
  readonly toolCall?: {
    readonly tool: string;
    readonly input: Record<string, unknown>;
  };

  /** Tool execution result (type: "tool_result"). */
  readonly toolResult?: {
    readonly tool: string;
    readonly output: string;
    readonly durationMs: number;
  };

  /** Token usage for this turn or cumulative (type: "token_usage"). */
  readonly tokenUsage?: TokenUsage;

  /** Failure details (type: "failure"). */
  readonly failure?: {
    readonly category: FailureCategory;
    /** Human-readable error message. */
    readonly message: string;
    /** Vendor-specific raw error details (for debugging, not classification). */
    readonly vendorDetail?: string;
  };

  /** Completion summary text (type: "completion"). */
  readonly completionSummary?: string;
}

// ── Failure taxonomy ─────────────────────────────────────────────────────

/**
 * Shared failure categories for both vendors.
 *
 * Both vendors map their raw errors into these categories. Run evaluation
 * and PRD status updates use these — not vendor-specific error strings.
 *
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md §7.5
 */
export type FailureCategory =
  | "auth"
  | "not_found"
  | "timeout"
  | "rate_limit"
  | "completion_rejected"
  | "budget_exceeded"
  | "spin_detected"
  | "malformed_output"
  | "mcp_unavailable"
  | "transient_exhausted"
  | "unknown";

// ── Runtime diagnostics ──────────────────────────────────────────────────

/**
 * Token usage diagnostic status.
 *
 * Separates "usage parity" from "usage completeness" (§7.6):
 * - `complete` — all token fields populated from vendor output
 * - `partial` — some fields present, others backfilled or absent
 * - `unavailable` — vendor did not provide usage data; values are zero/synthetic
 */
export type TokenDiagnosticStatus = "complete" | "partial" | "unavailable";

/**
 * Vendor-neutral run diagnostics.
 *
 * Makes the runtime identity floor observable in logs and tests.
 * Collected at run start and updated during execution.
 */
export interface RuntimeDiagnostics {
  /** Which LLM vendor is active. */
  readonly vendor: LLMVendor;
  /** Model identifier used for the run. */
  readonly model: string;
  /** Sandbox mode in effect. */
  readonly sandbox: SandboxMode;
  /** Approval policy in effect. */
  readonly approvals: ApprovalPolicy;
  /** Token usage diagnostic status. */
  readonly tokenDiagnosticStatus: TokenDiagnosticStatus;
  /** Output parse mode used by the vendor wrapper. */
  readonly parseMode: string;
  /** Vendor-specific diagnostic notes (e.g. "codex_usage_missing"). */
  readonly notes: ReadonlyArray<string>;
}

// ── Defaults ─────────────────────────────────────────────────────────────

/**
 * Default execution policy for autonomous agent runs.
 *
 * Maps to:
 * - Claude: `--allowed-tools` with the listed file tools + `Bash(cmd:*)` patterns
 * - Codex: `--sandbox workspace-write --approval-policy auto-edit`
 */
export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = {
  sandbox: "workspace-write",
  approvals: "never",
  networkAccess: false,
  writableRoots: ["."],
  allowedCommands: [],
  allowedFileTools: ["Read", "Edit", "Write", "Glob", "Grep"],
};

/**
 * All canonical prompt section names.
 *
 * Useful for iteration and validation. Vendor wrappers can check that
 * all expected sections are present before assembly.
 */
export const CANONICAL_PROMPT_SECTIONS: ReadonlyArray<PromptSectionName> = [
  "system",
  "workflow",
  "brief",
  "files",
  "validation",
  "completion",
] as const;

/**
 * All failure categories as an array.
 *
 * Useful for exhaustiveness checks in tests and switch statements.
 */
export const ALL_FAILURE_CATEGORIES: ReadonlyArray<FailureCategory> = [
  "auth",
  "not_found",
  "timeout",
  "rate_limit",
  "completion_rejected",
  "budget_exceeded",
  "spin_detected",
  "malformed_output",
  "mcp_unavailable",
  "transient_exhausted",
  "unknown",
] as const;

// ── Factory helpers ──────────────────────────────────────────────────────

/**
 * Create a prompt envelope from named sections.
 *
 * Filters out sections with empty content so vendor wrappers only see
 * sections that carry actual prompt text.
 */
export function createPromptEnvelope(
  sections: ReadonlyArray<PromptSection>,
): PromptEnvelope {
  return {
    sections: sections.filter((s) => s.content.length > 0),
  };
}

/**
 * Assemble a prompt envelope into the system prompt and task prompt strings.
 *
 * Separates sections into two groups:
 * - **system sections** (`system`, `workflow`) → concatenated into one string
 * - **task sections** (everything else) → concatenated into one string
 *
 * This separation maps directly to vendor delivery channels:
 * - Claude: system sections → `--system-prompt`; task sections → stdin
 * - Codex: both groups combined as `SYSTEM:\n...\nTASK:\n...`
 */
export function assemblePrompt(envelope: PromptEnvelope): {
  systemPrompt: string;
  taskPrompt: string;
} {
  const systemNames = new Set<PromptSectionName>(["system", "workflow"]);

  const systemParts: string[] = [];
  const taskParts: string[] = [];

  for (const section of envelope.sections) {
    if (systemNames.has(section.name)) {
      systemParts.push(section.content);
    } else {
      taskParts.push(section.content);
    }
  }

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: taskParts.join("\n\n"),
  };
}

/**
 * Map the legacy `ErrorReason` (from `types.ts`) to the normalized
 * {@link FailureCategory}.
 *
 * This bridge function allows existing error handling code to adopt the
 * new taxonomy incrementally.
 */
export function mapErrorReasonToFailureCategory(
  reason: string,
): FailureCategory {
  switch (reason) {
    case "auth":
      return "auth";
    case "not-found":
      return "not_found";
    case "timeout":
      return "timeout";
    case "rate-limit":
      return "rate_limit";
    case "cli":
    case "unknown":
    default:
      return "unknown";
  }
}

/**
 * Map a hench run failure reason string to the normalized
 * {@link FailureCategory}.
 *
 * Hench currently uses ad hoc reason strings in `handleRunFailure()`.
 * This function centralizes the mapping so both vendors produce the same
 * category for the same failure condition.
 */
export function mapRunFailureToCategory(
  reason: string,
): FailureCategory {
  switch (reason) {
    case "spin_detected":
      return "spin_detected";
    case "completion_rejected":
      return "completion_rejected";
    case "budget_exceeded":
      return "budget_exceeded";
    case "task_failed":
      return "unknown";
    case "task_transient_exhausted":
      return "transient_exhausted";
    default:
      return "unknown";
  }
}

// ── Vendor-neutral error classification ──────────────────────────────────

/**
 * Regex patterns for classifying vendor-agnostic error messages into
 * {@link FailureCategory} values.
 *
 * Order matters — first match wins. More specific patterns come before
 * broader ones.
 */
const VENDOR_ERROR_PATTERNS: ReadonlyArray<readonly [RegExp, FailureCategory]> = [
  // Auth failures (Claude + Codex)
  [/ANTHROPIC_API_KEY|OPENAI_API_KEY|api.key/i, "auth"],
  [/unauthorized|invalid api key|api key was rejected|forbidden|auth failed|\b401\b/i, "auth"],
  [/not logged in|login required/i, "auth"],

  // Rate limiting
  [/rate.limit|too many requests|\b429\b/i, "rate_limit"],

  // Timeout
  [/timeout|timed? ?out|ETIMEDOUT/i, "timeout"],

  // Budget
  [/budget.exceeded|spending limit|token limit reached/i, "budget_exceeded"],

  // Not found (CLI binary, model, endpoint)
  [/not found|ENOENT|\b404\b/i, "not_found"],

  // Malformed output
  [/unexpected token|malformed|invalid json|parse error|SyntaxError/i, "malformed_output"],

  // Transient infrastructure
  [/\b500\b|\b502\b|\b503\b|\b529\b|overloaded|ECONNRESET|ECONNREFUSED|socket hang up|stream disconnected/i, "transient_exhausted"],
];

/**
 * Classify an arbitrary error into the shared {@link FailureCategory} taxonomy.
 *
 * Classification strategy (in priority order):
 * 1. {@link ClaudeClientError} — uses the existing `reason` field via
 *    {@link mapErrorReasonToFailureCategory}.
 * 2. Error message pattern matching — vendor-agnostic regex patterns.
 * 3. Fallback — `"unknown"`.
 *
 * This is the single entry point for user-facing error classification.
 * Both Claude and Codex error paths should converge here.
 */
export function classifyVendorError(err: unknown): FailureCategory {
  // ClaudeClientError already carries a classified reason
  if (err instanceof ClaudeClientError) {
    return mapErrorReasonToFailureCategory(err.reason);
  }

  const message = err instanceof Error ? err.message : String(err);

  for (const [pattern, category] of VENDOR_ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return category;
    }
  }

  return "unknown";
}

/**
 * User-facing label for a {@link FailureCategory}.
 *
 * Returns a short, lowercase, human-readable phrase suitable for log
 * messages and CLI output. Keeps the taxonomy readable without exposing
 * raw enum values to users.
 */
export function failureCategoryLabel(category: FailureCategory): string {
  switch (category) {
    case "auth":
      return "authentication failure";
    case "not_found":
      return "resource not found";
    case "timeout":
      return "operation timed out";
    case "rate_limit":
      return "rate limit exceeded";
    case "completion_rejected":
      return "completion rejected";
    case "budget_exceeded":
      return "token budget exceeded";
    case "spin_detected":
      return "agent loop detected";
    case "malformed_output":
      return "malformed output";
    case "mcp_unavailable":
      return "MCP server unavailable";
    case "transient_exhausted":
      return "transient failures exhausted retries";
    case "unknown":
      return "unexpected error";
  }
}
