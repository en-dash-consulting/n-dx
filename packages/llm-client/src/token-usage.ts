/**
 * Token usage parsing utilities.
 *
 * Handles both Anthropic SDK response format and CLI stream-json format,
 * providing a single consistent TokenUsage shape.
 *
 * ## Diagnostic-aware parsing
 *
 * Each parser has a `*WithDiagnostic` variant that returns a
 * {@link TokenParseResult} pairing the parsed usage with a
 * {@link TokenDiagnosticStatus}. The status distinguishes "vendor returned
 * usage data" from "vendor omitted usage data (zeros are synthetic)":
 *
 * - `complete` — both input and output fields were present and numeric
 * - `partial` — only one of input/output was present; the other was backfilled to 0
 * - `unavailable` — neither field was present; values are synthetic zeros
 *
 * Call sites that need to surface degraded diagnostics (e.g. run records,
 * RuntimeDiagnostics) should use the `*WithDiagnostic` variants.
 */

import type { TokenUsage } from "./types.js";
import type { TokenDiagnosticStatus } from "./runtime-contract.js";

// ── Diagnostic-aware result type ──────────────────────────────────────────

/**
 * Token usage paired with its diagnostic status.
 *
 * Used by diagnostic-aware parsers to distinguish "the vendor returned zeros"
 * from "the vendor omitted usage data and we backfilled zeros".
 */
export interface TokenParseResult {
  /** Parsed token usage (may be synthetic zeros when status is "unavailable"). */
  readonly usage: TokenUsage;
  /** Whether the usage data was fully present, partially present, or absent. */
  readonly diagnosticStatus: TokenDiagnosticStatus;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Classify the diagnostic status from presence of the two primary fields. */
function classifyPresence(
  hasInput: boolean,
  hasOutput: boolean,
): TokenDiagnosticStatus {
  if (hasInput && hasOutput) return "complete";
  if (hasInput || hasOutput) return "partial";
  return "unavailable";
}

/** Extract cache fields from a raw object, returning only non-zero values. */
function extractCacheFields(
  source: Record<string, unknown>,
): Pick<TokenUsage, "cacheCreationInput" | "cacheReadInput"> {
  const result: Pick<TokenUsage, "cacheCreationInput" | "cacheReadInput"> = {};
  const cacheCreation = source.cache_creation_input_tokens;
  if (typeof cacheCreation === "number" && cacheCreation > 0) {
    result.cacheCreationInput = cacheCreation;
  }
  const cacheRead = source.cache_read_input_tokens;
  if (typeof cacheRead === "number" && cacheRead > 0) {
    result.cacheReadInput = cacheRead;
  }
  return result;
}

// ── API token parsing ─────────────────────────────────────────────────────

/**
 * Parse token usage from an Anthropic API SDK response `usage` object.
 *
 * The SDK response always has `input_tokens` / `output_tokens` at the top level.
 * Cache fields (`cache_creation_input_tokens`, `cache_read_input_tokens`) are
 * present on some models/versions but not typed in the SDK, so we extract them
 * from the raw object.
 *
 * Always returns a TokenUsage — missing numeric fields default to 0.
 * Cache fields are omitted when zero or absent.
 */
export function parseApiTokenUsage(
  raw: Record<string, unknown>,
): TokenUsage {
  return parseApiTokenUsageWithDiagnostic(raw).usage;
}

/**
 * Diagnostic-aware variant of {@link parseApiTokenUsage}.
 *
 * Returns both the parsed usage and a {@link TokenDiagnosticStatus} indicating
 * whether the vendor provided complete, partial, or no usage data.
 */
export function parseApiTokenUsageWithDiagnostic(
  raw: Record<string, unknown>,
): TokenParseResult {
  const hasInput = typeof raw.input_tokens === "number";
  const hasOutput = typeof raw.output_tokens === "number";

  const input = hasInput ? (raw.input_tokens as number) : 0;
  const output = hasOutput ? (raw.output_tokens as number) : 0;

  return {
    usage: { input, output, ...extractCacheFields(raw) },
    diagnosticStatus: classifyPresence(hasInput, hasOutput),
  };
}

// ── CLI token parsing ─────────────────────────────────────────────────────

/**
 * Parse token usage from a Claude CLI JSON envelope.
 *
 * Claude CLI --output-format json includes usage fields at the top level:
 * `input_tokens` / `total_input_tokens`, `output_tokens` / `total_output_tokens`.
 *
 * Returns undefined when no token fields are found.
 * Cache fields are omitted when zero or absent.
 */
export function parseCliTokenUsage(
  envelope: Record<string, unknown>,
): TokenUsage | undefined {
  const result = parseCliTokenUsageWithDiagnostic(envelope);
  return result.diagnosticStatus === "unavailable" ? undefined : result.usage;
}

/**
 * Diagnostic-aware variant of {@link parseCliTokenUsage}.
 *
 * Returns a {@link TokenParseResult} instead of `undefined` for missing data,
 * allowing callers to surface the "unavailable" status explicitly.
 */
export function parseCliTokenUsageWithDiagnostic(
  envelope: Record<string, unknown>,
): TokenParseResult {
  const rawInput = envelope.input_tokens ?? envelope.total_input_tokens;
  const rawOutput = envelope.output_tokens ?? envelope.total_output_tokens;

  const hasInput = typeof rawInput === "number";
  const hasOutput = typeof rawOutput === "number";

  return {
    usage: {
      input: hasInput ? (rawInput as number) : 0,
      output: hasOutput ? (rawOutput as number) : 0,
      ...extractCacheFields(envelope),
    },
    diagnosticStatus: classifyPresence(hasInput, hasOutput),
  };
}

// ── Stream token parsing ──────────────────────────────────────────────────

/**
 * Parse token usage from a CLI stream-json event.
 *
 * Stream-json events may include token usage:
 * - At the top level: `input_tokens`, `output_tokens`
 * - As fallback: `total_input_tokens`, `total_output_tokens`
 * - Inside a nested `usage` object (some CLI versions)
 *
 * Prefers `input_tokens` over `total_input_tokens`.
 * Prefers top-level fields over nested `usage` object.
 * Returns undefined when no token fields are found.
 * Cache fields are omitted when zero or absent.
 */
export function parseStreamTokenUsage(
  obj: Record<string, unknown>,
): TokenUsage | undefined {
  const result = parseStreamTokenUsageWithDiagnostic(obj);
  return result.diagnosticStatus === "unavailable" ? undefined : result.usage;
}

/**
 * Diagnostic-aware variant of {@link parseStreamTokenUsage}.
 *
 * Returns a {@link TokenParseResult} instead of `undefined` for missing data,
 * allowing callers to surface the "unavailable" status explicitly.
 */
export function parseStreamTokenUsageWithDiagnostic(
  obj: Record<string, unknown>,
): TokenParseResult {
  // Try direct fields first (prefer input_tokens over total_input_tokens)
  let rawInput: unknown = obj.input_tokens ?? obj.total_input_tokens;
  let rawOutput: unknown = obj.output_tokens ?? obj.total_output_tokens;
  let cacheSource: Record<string, unknown> = obj;

  // Try nested usage object (stream-json format) — only if top-level has nothing
  if (
    typeof rawInput !== "number" &&
    typeof rawOutput !== "number" &&
    obj.usage &&
    typeof obj.usage === "object" &&
    !Array.isArray(obj.usage)
  ) {
    const nested = obj.usage as Record<string, unknown>;
    rawInput = nested.input_tokens ?? nested.total_input_tokens;
    rawOutput = nested.output_tokens ?? nested.total_output_tokens;
    cacheSource = nested;
  }

  const hasInput = typeof rawInput === "number";
  const hasOutput = typeof rawOutput === "number";

  return {
    usage: {
      input: hasInput ? (rawInput as number) : 0,
      output: hasOutput ? (rawOutput as number) : 0,
      ...extractCacheFields(cacheSource),
    },
    diagnosticStatus: classifyPresence(hasInput, hasOutput),
  };
}

// ── Codex token parsing ───────────────────────────────────────────────────

/** Safe cast to Record<string, unknown> or undefined. */
function asUsageRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** Read first matching numeric field from an object. */
function readNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Token usage result from Codex payload mapping.
 *
 * Uses the vendor-neutral {@link TokenDiagnosticStatus} instead of the
 * previous Codex-specific string literal. Callers can inspect
 * `diagnosticStatus` to determine if usage data was present.
 */
export interface CodexTokenMapping {
  usage: TokenUsage;
  total: number;
  diagnosticStatus: TokenDiagnosticStatus;
}

/**
 * Map Codex usage payload fields into the shared token usage shape.
 *
 * Explicit field mapping:
 * - input: `input_tokens` | `prompt_tokens`
 * - output: `output_tokens` | `completion_tokens`
 * - total: `total_tokens` fallback, otherwise `input + output`
 *
 * When usage is missing, returns zeros and `diagnosticStatus: "unavailable"`.
 * When all fields are present, returns `diagnosticStatus: "complete"`.
 */
export function mapCodexUsageToTokenUsage(raw: unknown): CodexTokenMapping {
  const top = asUsageRecord(raw);
  const usage = asUsageRecord(top?.usage)
    ?? asUsageRecord(asUsageRecord(top?.response)?.usage)
    ?? asUsageRecord(asUsageRecord(top?.data)?.usage);

  if (!usage && !top) {
    return {
      usage: { input: 0, output: 0 },
      total: 0,
      diagnosticStatus: "unavailable",
    };
  }

  const source = usage ?? top ?? {};

  const input = readNumber(source, ["input_tokens", "prompt_tokens", "input"]) ?? 0;
  const output = readNumber(source, ["output_tokens", "completion_tokens", "output"]) ?? 0;
  const total = readNumber(source, ["total_tokens", "total"]) ?? (input + output);

  const hasUsageFields = usage
    ? input > 0 || output > 0 || total > 0
    : readNumber(source, ["input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens"]) !== undefined;

  return {
    usage: { input, output },
    total,
    diagnosticStatus: hasUsageFields ? "complete" : "unavailable",
  };
}
