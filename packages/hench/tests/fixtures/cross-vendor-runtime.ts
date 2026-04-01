/**
 * Cross-vendor runtime fixtures.
 *
 * Shared test data that proves Claude and Codex runs operate on the same
 * prompt sections, execution policy, event schema, failure taxonomy, token
 * diagnostics, and completion gates.
 *
 * Used by cross-vendor-parity.test.ts (unit) and cross-vendor-init-smoke.test.ts
 * (integration) to verify the runtime identity floor across vendors.
 *
 * @see packages/llm-client/src/runtime-contract.ts — source of truth
 * @see docs/analysis/claude-codex-runtime-identity-discovery.md — design rationale
 */

import type {
  PromptSection,
  ExecutionPolicy,
  RuntimeEvent,
  FailureCategory,
  RuntimeDiagnostics,
} from "../../../llm-client/src/runtime-contract.js";
import type { TokenUsage } from "../../../llm-client/src/types.js";

// ── Prompt envelope fixtures ──────────────────────────────────────────────

/**
 * A full prompt envelope covering all 6 canonical sections.
 * Both Claude and Codex must receive the same logical content.
 */
export const FULL_PROMPT_SECTIONS: readonly PromptSection[] = [
  { name: "system", content: "You are Hench, an autonomous AI agent." },
  { name: "workflow", content: "Follow TDD: red → green → refactor." },
  { name: "brief", content: "Implement user authentication with JWT." },
  { name: "files", content: "src/auth.ts — existing auth module." },
  { name: "validation", content: "Run `npm test` and `npm run typecheck`." },
  { name: "completion", content: "Done when all tests pass and types check." },
] as const;

/**
 * Minimal prompt envelope (only required sections).
 * Tests that both vendors handle sparse envelopes identically.
 */
export const MINIMAL_PROMPT_SECTIONS: readonly PromptSection[] = [
  { name: "system", content: "You are Hench." },
  { name: "brief", content: "Fix the bug." },
] as const;

// ── Execution policy fixtures ─────────────────────────────────────────────

/**
 * Standard autonomous execution policy.
 * Both vendors compile from this single policy object.
 */
export const STANDARD_POLICY: ExecutionPolicy = {
  sandbox: "workspace-write",
  approvals: "never",
  networkAccess: false,
  writableRoots: ["."],
  allowedCommands: [],
  allowedFileTools: ["Read", "Edit", "Write", "Glob", "Grep"],
};

/**
 * Read-only policy for analysis-only runs.
 * Tests that restrictive policies compile correctly for both vendors.
 */
export const READONLY_POLICY: ExecutionPolicy = {
  sandbox: "read-only",
  approvals: "on-request",
  networkAccess: false,
  writableRoots: [],
  allowedCommands: [],
  allowedFileTools: ["Read", "Glob", "Grep"],
};

/**
 * Full-access policy for CI/admin runs.
 * Tests that permissive policies compile correctly for both vendors.
 */
export const FULL_ACCESS_POLICY: ExecutionPolicy = {
  sandbox: "danger-full-access",
  approvals: "never",
  networkAccess: true,
  writableRoots: ["."],
  allowedCommands: ["npm", "git", "node", "tsc"],
  allowedFileTools: ["Read", "Edit", "Write", "Glob", "Grep"],
};

// ── Runtime event fixtures ────────────────────────────────────────────────

/** Base timestamp for deterministic event ordering. */
const BASE_TS = "2026-03-31T00:00:00.000Z";

/** Increment a base ISO timestamp by N seconds. */
function offsetTs(seconds: number): string {
  return new Date(new Date(BASE_TS).getTime() + seconds * 1000).toISOString();
}

/**
 * Create a matched pair of runtime events (one Claude, one Codex) with
 * identical logical content but different vendor provenance.
 *
 * This is the core assertion helper: if two events differ only in `vendor`,
 * they prove that the normalized schema is vendor-neutral.
 */
function vendorPair(
  base: Omit<RuntimeEvent, "vendor">,
): { claude: RuntimeEvent; codex: RuntimeEvent } {
  return {
    claude: { ...base, vendor: "claude" },
    codex: { ...base, vendor: "codex" },
  };
}

/** Assistant message event pair. */
export const ASSISTANT_EVENT = vendorPair({
  type: "assistant",
  turn: 1,
  timestamp: offsetTs(0),
  text: "I will fix the authentication bug by updating the JWT validation.",
});

/** Tool use event pair. */
export const TOOL_USE_EVENT = vendorPair({
  type: "tool_use",
  turn: 2,
  timestamp: offsetTs(1),
  toolCall: {
    tool: "Edit",
    input: { file_path: "src/auth.ts", old_string: "bug", new_string: "fix" },
  },
});

/** Tool result event pair. */
export const TOOL_RESULT_EVENT = vendorPair({
  type: "tool_result",
  turn: 2,
  timestamp: offsetTs(2),
  toolResult: {
    tool: "Edit",
    output: "File edited successfully.",
    durationMs: 42,
  },
});

/** Token usage event pair. */
export const TOKEN_USAGE_EVENT = vendorPair({
  type: "token_usage",
  turn: 3,
  timestamp: offsetTs(3),
  tokenUsage: { input: 1500, output: 400, cacheReadInput: 200 },
});

/** Failure event pair. */
export const FAILURE_EVENT = vendorPair({
  type: "failure",
  turn: 1,
  timestamp: offsetTs(0),
  failure: {
    category: "auth",
    message: "Authentication failed: invalid API key",
    vendorDetail: "HTTP 401 Unauthorized",
  },
});

/** Completion event pair. */
export const COMPLETION_EVENT = vendorPair({
  type: "completion",
  turn: 5,
  timestamp: offsetTs(10),
  completionSummary: "Fixed the JWT validation bug. All tests pass.",
});

/**
 * Full event sequence fixture — a complete run scenario that both vendors
 * must produce identically (modulo vendor field).
 */
export const FULL_RUN_SEQUENCE = {
  claude: [
    ASSISTANT_EVENT.claude,
    TOOL_USE_EVENT.claude,
    TOOL_RESULT_EVENT.claude,
    TOKEN_USAGE_EVENT.claude,
    COMPLETION_EVENT.claude,
  ],
  codex: [
    ASSISTANT_EVENT.codex,
    TOOL_USE_EVENT.codex,
    TOOL_RESULT_EVENT.codex,
    TOKEN_USAGE_EVENT.codex,
    COMPLETION_EVENT.codex,
  ],
};

// ── Failure classification fixtures ───────────────────────────────────────

/**
 * Error messages that must classify to the same FailureCategory regardless
 * of whether they originate from Claude or Codex.
 *
 * Each entry: [error message, expected category, description]
 */
export const CROSS_VENDOR_ERROR_FIXTURES: readonly {
  message: string;
  expected: FailureCategory;
  description: string;
}[] = [
  // Auth errors (both vendors)
  { message: "Missing ANTHROPIC_API_KEY", expected: "auth", description: "Claude auth: missing API key env var" },
  { message: "Missing OPENAI_API_KEY", expected: "auth", description: "Codex auth: missing API key env var" },
  { message: "Error: invalid api key", expected: "auth", description: "generic auth: invalid key" },
  { message: "HTTP 401 Unauthorized", expected: "auth", description: "HTTP auth: 401 status" },
  { message: "not logged in", expected: "auth", description: "CLI auth: not logged in" },

  // Rate limiting (both vendors)
  { message: "rate limit exceeded", expected: "rate_limit", description: "generic rate limit" },
  { message: "HTTP 429 Too Many Requests", expected: "rate_limit", description: "HTTP rate limit: 429 status" },

  // Timeout (both vendors)
  { message: "request timed out", expected: "timeout", description: "generic timeout" },
  { message: "connect ETIMEDOUT 1.2.3.4:443", expected: "timeout", description: "Node.js ETIMEDOUT" },
  { message: "codex exec timed out after 30000ms", expected: "timeout", description: "Codex CLI timeout" },

  // Budget (both vendors)
  { message: "budget exceeded for this run", expected: "budget_exceeded", description: "n-dx budget exceeded" },
  { message: "token limit reached", expected: "budget_exceeded", description: "token limit reached" },

  // Not found (both vendors)
  { message: "claude: not found", expected: "not_found", description: "Claude CLI not found" },
  { message: "codex: not found", expected: "not_found", description: "Codex CLI not found" },
  { message: "ENOENT: no such file", expected: "not_found", description: "filesystem not found" },

  // Malformed output (both vendors)
  { message: "Unexpected token < in JSON", expected: "malformed_output", description: "Claude JSON parse error" },
  { message: "SyntaxError: invalid json body", expected: "malformed_output", description: "Codex JSON parse error" },

  // Transient infrastructure (both vendors)
  { message: "HTTP 502 Bad Gateway", expected: "transient_exhausted", description: "Anthropic 502" },
  { message: "HTTP 529 overloaded", expected: "transient_exhausted", description: "Anthropic 529" },
  { message: "ECONNRESET", expected: "transient_exhausted", description: "connection reset" },
  { message: "socket hang up", expected: "transient_exhausted", description: "socket hang up" },

  // Unknown (both vendors)
  { message: "something completely unexpected happened", expected: "unknown", description: "unrecognized error" },
];

// ── Token diagnostic fixtures ─────────────────────────────────────────────

/**
 * Token usage payloads that must produce identical TokenUsage shapes
 * regardless of which vendor parser processes them.
 *
 * Each entry includes the raw payload format for both Claude (API/stream)
 * and Codex, plus the expected normalized result.
 */
export const TOKEN_DIAGNOSTIC_FIXTURES: readonly {
  description: string;
  claudeApiPayload: Record<string, unknown>;
  codexPayload: unknown;
  expectedUsage: TokenUsage;
  expectedClaudeDiagnostic: "complete" | "partial" | "unavailable";
  expectedCodexDiagnostic: "complete" | "unavailable";
}[] = [
  {
    description: "complete usage from both vendors",
    claudeApiPayload: { input_tokens: 1000, output_tokens: 250 },
    codexPayload: { usage: { input_tokens: 1000, output_tokens: 250 } },
    expectedUsage: { input: 1000, output: 250 },
    expectedClaudeDiagnostic: "complete",
    expectedCodexDiagnostic: "complete",
  },
  {
    description: "zero usage from both vendors",
    claudeApiPayload: {},
    codexPayload: { status: "completed" },
    expectedUsage: { input: 0, output: 0 },
    expectedClaudeDiagnostic: "unavailable",
    expectedCodexDiagnostic: "unavailable",
  },
  {
    description: "Codex with prompt_tokens/completion_tokens naming",
    claudeApiPayload: { input_tokens: 500, output_tokens: 100 },
    codexPayload: { usage: { prompt_tokens: 500, completion_tokens: 100 } },
    expectedUsage: { input: 500, output: 100 },
    expectedClaudeDiagnostic: "complete",
    expectedCodexDiagnostic: "complete",
  },
];

// ── RuntimeDiagnostics fixtures ───────────────────────────────────────────

/**
 * RuntimeDiagnostics for both vendors at the same execution state.
 * Tests that the diagnostic surface captures vendor identity correctly.
 */
export const DIAGNOSTICS_FIXTURES: {
  claude: RuntimeDiagnostics;
  codex: RuntimeDiagnostics;
} = {
  claude: {
    vendor: "claude",
    model: "claude-sonnet-4-6",
    sandbox: "workspace-write",
    approvals: "never",
    tokenDiagnosticStatus: "complete",
    parseMode: "stream-json",
    notes: [],
  },
  codex: {
    vendor: "codex",
    model: "gpt-5-codex",
    sandbox: "workspace-write",
    approvals: "never",
    tokenDiagnosticStatus: "complete",
    parseMode: "json",
    notes: [],
  },
};

// ── Completion gate fixtures ──────────────────────────────────────────────

/**
 * Completion criteria that apply identically to both vendors.
 * The completion gate is vendor-neutral — it evaluates run output,
 * not vendor-specific events.
 */
export const COMPLETION_GATE_FIXTURES: readonly {
  description: string;
  criteria: string;
  runSummary: string;
  expectSatisfied: boolean;
}[] = [
  {
    description: "tests pass criteria met",
    criteria: "All tests pass",
    runSummary: "All tests pass. Build succeeded.",
    expectSatisfied: true,
  },
  {
    description: "tests pass criteria not met",
    criteria: "All tests pass",
    runSummary: "3 tests failed. Build succeeded.",
    expectSatisfied: false,
  },
  {
    description: "commit criteria met",
    criteria: "Changes committed to git",
    runSummary: "Committed changes: abc1234. All tests pass.",
    expectSatisfied: true,
  },
];
