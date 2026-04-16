/**
 * Shared utilities for the analyze module.
 *
 * This module exists to break circular dependencies between reason.ts,
 * extract.ts, and file-validation.ts. Pure utilities and constants that
 * multiple analyze modules need are defined here so that no consumer
 * needs to import from reason.ts (which dynamically imports extract.ts).
 *
 * @module rex/analyze/analyze-shared
 */

import { extname } from "node:path";
import type { TokenUsage, AnalyzeTokenUsage } from "../schema/index.js";
import { NEWEST_MODELS } from "@n-dx/llm-client";

// ── Model defaults ──
// Derived from the single canonical source in @n-dx/llm-client so that
// updating a vendor's newest model requires only one edit.

export const DEFAULT_MODEL = NEWEST_MODELS.claude;
export const DEFAULT_CODEX_MODEL = NEWEST_MODELS.codex;

/** Maximum number of LLM retry attempts for transient/parse failures. */
export const MAX_RETRIES = 2;

// ── Token usage helpers ──

/** Result from a Claude CLI call, including text and optional token usage. */
export interface ClaudeResult {
  text: string;
  tokenUsage?: TokenUsage;
}

/** Parse token usage from a claude CLI JSON envelope. */
export function parseTokenUsage(envelope: Record<string, unknown>): TokenUsage | undefined {
  // Claude CLI --output-format json includes usage fields at the top level
  const input = envelope.input_tokens ?? envelope.total_input_tokens;
  const output = envelope.output_tokens ?? envelope.total_output_tokens;

  if (typeof input !== "number" && typeof output !== "number") {
    return undefined;
  }

  const usage: TokenUsage = {
    input: typeof input === "number" ? input : 0,
    output: typeof output === "number" ? output : 0,
  };

  const cacheCreation = envelope.cache_creation_input_tokens;
  const cacheRead = envelope.cache_read_input_tokens;
  if (typeof cacheCreation === "number" && cacheCreation > 0) {
    usage.cacheCreationInput = cacheCreation;
  }
  if (typeof cacheRead === "number" && cacheRead > 0) {
    usage.cacheReadInput = cacheRead;
  }

  return usage;
}

/** Create an empty AnalyzeTokenUsage accumulator. */
export function emptyAnalyzeTokenUsage(): AnalyzeTokenUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0 };
}

/** Accumulate a single call's token usage into the aggregate. */
export function accumulateTokenUsage(
  aggregate: AnalyzeTokenUsage,
  usage?: TokenUsage,
): void {
  aggregate.calls++;
  if (!usage) return;
  aggregate.inputTokens += usage.input;
  aggregate.outputTokens += usage.output;
  if (usage.cacheCreationInput) {
    aggregate.cacheCreationInputTokens =
      (aggregate.cacheCreationInputTokens ?? 0) + usage.cacheCreationInput;
  }
  if (usage.cacheReadInput) {
    aggregate.cacheReadInputTokens =
      (aggregate.cacheReadInputTokens ?? 0) + usage.cacheReadInput;
  }
}

// ── Format detection ──

export type FileFormat = "markdown" | "text" | "json" | "yaml";

const FORMAT_MAP: Record<string, FileFormat> = {
  ".md": "markdown",
  ".txt": "text",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export function detectFileFormat(filePath: string): FileFormat {
  const ext = extname(filePath).toLowerCase();
  return FORMAT_MAP[ext] ?? "markdown";
}

// ── JSON extraction utilities ──

/**
 * Walk a JSON structure starting at `open` (`[` or `{`), tracking nesting
 * and string state, and return the index of the matching close character.
 * Returns -1 if the structure is never closed (truncated).
 */
function findMatchingClose(text: string, startIndex: number): number {
  const open = text[startIndex];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Extract JSON text from an LLM response, handling markdown fences,
 * leading prose, and trailing text after the JSON array or object.
 */
export function extractJson(raw: string): string {
  let text = raw.trim();

  // Try markdown code fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Find the start of a top-level JSON array. When text already starts with
  // `[`, the search begins at index 0. Otherwise, look for `[` at the
  // beginning of a line (to avoid matching arrays embedded in object values).
  let arrayStart = -1;
  if (text.startsWith("[")) {
    arrayStart = 0;
  } else {
    const match = text.match(/(?:^|\n)\s*(\[)/);
    if (match) {
      arrayStart = text.indexOf(match[1], match.index!);
    }
  }

  if (arrayStart >= 0) {
    text = text.slice(arrayStart);
    const closeIdx = findMatchingClose(text, 0);
    if (closeIdx >= 0) {
      return text.slice(0, closeIdx + 1);
    }
    // Unclosed array — return the sliced text for downstream repair
    return text;
  }

  // Handle JSON objects: find the first `{` (at start or on its own line)
  // and match its closing `}`, stripping leading and trailing prose.
  let objStart = -1;
  if (text.startsWith("{")) {
    objStart = 0;
  } else {
    const match = text.match(/(?:^|\n)\s*(\{)/);
    if (match) {
      objStart = text.indexOf(match[1], match.index!);
    }
  }

  if (objStart >= 0) {
    text = text.slice(objStart);
    const closeIdx = findMatchingClose(text, 0);
    if (closeIdx >= 0) {
      return text.slice(0, closeIdx + 1);
    }
    // Unclosed object — return sliced text for downstream repair
    return text;
  }

  // Fallback: scan for the first `[` or `{` anywhere in the text.
  //
  // The line-start searches above intentionally require JSON to begin at the
  // start of a line to avoid matching arrays/objects embedded inside prose
  // (e.g. "[a, b, c]" within a sentence). However, some LLM outputs (notably
  // Codex) place JSON inline without a leading newline:
  //
  //   "Here are the proposals: [{...}]"
  //
  // This fallback handles that pattern. Arrays are preferred over bare objects
  // to match the expected top-level proposal format.
  const inlineArrayIdx = text.indexOf("[");
  const inlineObjIdx = text.indexOf("{");

  const inlineStart =
    inlineArrayIdx >= 0 && (inlineObjIdx < 0 || inlineArrayIdx < inlineObjIdx)
      ? inlineArrayIdx
      : inlineObjIdx;

  if (inlineStart >= 0) {
    const slice = text.slice(inlineStart);
    const closeIdx = findMatchingClose(slice, 0);
    if (closeIdx >= 0) {
      return slice.slice(0, closeIdx + 1);
    }
    // Unclosed — return sliced text for downstream repair
    return slice;
  }

  return text;
}

/**
 * Strip incomplete escape sequences from the end of a truncated JSON string.
 * Handles:
 *  - trailing lone backslash (`"path\` → `"path`)
 *  - partial unicode escapes (`"emoji \u00` → `"emoji `)
 */
function stripTrailingEscape(s: string): string {
  // Strip partial \uXXXX (1-4 hex digits after \u)
  const partialUnicode = s.match(/\\u[\da-fA-F]{0,3}$/);
  if (partialUnicode) return s.slice(0, partialUnicode.index);

  // Strip lone trailing backslash (incomplete escape)
  if (s.endsWith("\\")) {
    // But not an escaped backslash (\\) — count consecutive trailing backslashes
    let count = 0;
    for (let i = s.length - 1; i >= 0 && s[i] === "\\"; i--) count++;
    // Odd number means the last backslash is a lone escape starter
    if (count % 2 === 1) return s.slice(0, -1);
  }

  return s;
}

/**
 * Attempt to repair truncated JSON by closing any open structures.
 * Handles trailing commas, truncated strings, mid-key/mid-value
 * truncation, and unclosed brackets/braces.
 * Returns repaired JSON string or null if not repairable.
 */
export function repairTruncatedJson(text: string): string | null {
  // Only attempt repair on text that starts as a JSON array or object
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;

  // Try parsing as-is first
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with repair
  }

  // Track open brackets, braces, and string state
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const ch of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === "]" || ch === "}") {
      stack.pop();
    }
  }

  if (stack.length === 0) return null;

  // Close any unclosed string, stripping incomplete escape sequences first
  let repaired = trimmed;
  if (inString) repaired = stripTrailingEscape(repaired) + '"';

  // Close structures in reverse order
  while (stack.length > 0) {
    const open = stack.pop()!;
    repaired += open === "[" ? "]" : "}";
  }

  // Validate the repaired JSON actually parses
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // The naive close didn't work (trailing commas, partial values, etc.)
    // Try progressively stripping trailing junk before closing
  }

  // Strategy: progressively strip trailing incomplete tokens from the
  // truncation point. Each pattern removes one layer of junk:
  //   - trailing commas/whitespace
  //   - dangling colons (key with no value)
  //   - partial key-value pairs (e.g. `,"feat` or `,"key":"val`)
  //   - orphaned keys without values
  //   - bare partial literals after a colon (e.g. `:"nul`, `:"fals`, `:"tr`)
  const stripPatterns = [
    // Trailing comma, colon, or whitespace
    /[,:\s]+$/,
    // Dangling key with optional colon: `,"key":` or `,"key"` or `,"ke`
    /,\s*"[^"]*"?\s*:?\s*$/,
    // Dangling value token (partial string, number, bool, null)
    /,\s*(?:"[^"]*"?|[\d.]+|true|false|null)\s*$/,
    // Orphan key without comma prefix: `"key":` at end of object
    /"\w*"?\s*:?\s*$/,
    // Bare partial literal after colon (handles truncated true/false/null)
    /:\s*(?:t(?:r(?:ue?)?)?|f(?:a(?:l(?:se?)?)?)?|n(?:u(?:ll?)?)?|[\d.]+)\s*$/,
  ];

  let content = trimmed;
  if (inString) content = stripTrailingEscape(content) + '"';

  for (let attempts = 0; attempts < 20; attempts++) {
    // Recompute the structure stack for the current content
    let innerString = false;
    let innerEscaped = false;
    const innerStack: string[] = [];

    for (const ch of content) {
      if (innerEscaped) { innerEscaped = false; continue; }
      if (ch === "\\") { innerEscaped = true; continue; }
      if (ch === '"') { innerString = !innerString; continue; }
      if (innerString) continue;
      if (ch === "[" || ch === "{") innerStack.push(ch);
      else if (ch === "]" || ch === "}") innerStack.pop();
    }

    let candidate = content;
    if (innerString) candidate = stripTrailingEscape(candidate) + '"';

    const closingStack = [...innerStack];
    while (closingStack.length > 0) {
      const open = closingStack.pop()!;
      candidate += open === "[" ? "]" : "}";
    }

    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try each strip pattern until one makes progress
      let stripped = false;
      for (const pattern of stripPatterns) {
        const result = content.replace(pattern, "");
        if (result.length < content.length) {
          content = result;
          stripped = true;
          break;
        }
      }
      if (!stripped) break;
    }
  }

  return null;
}

// ── Prompt constants ──

export const PRD_SCHEMA = `Each element must be an object with:
- "epic": { "title": string, "existingId"?: string, "status"?: "completed"|"pending" }
- "features": array of { "title": string, "description"?: string, "existingId"?: string, "status"?: "completed"|"pending", "tasks": array of { "title": string, "description"?: string, "acceptanceCriteria"?: string[], "priority"?: "critical"|"high"|"medium"|"low", "tags"?: string[], "status"?: "completed"|"pending", "loe"?: number, "loeRationale"?: string, "loeConfidence"?: "low"|"medium"|"high" } }
The optional "existingId" on epics and features references an existing PRD item by ID — use it to place new items under existing containers instead of creating duplicates.
The optional "status" field defaults to "pending". Set to "completed" when the code already implements the described functionality (used during baseline scans of existing codebases).

Level-of-Effort (LoE) fields on tasks:
- "loe": estimated effort in engineer-weeks (positive number, e.g. 0.5, 1, 2, 4).
- "loeRationale": one-sentence explanation justifying the estimate (mention key cost drivers).
- "loeConfidence": your confidence in the estimate — "low" (novel domain, many unknowns), "medium" (some unknowns but bounded scope), or "high" (well-understood, similar work done before).
Include all three LoE fields on every task.`;

/**
 * Shared task-quality guidelines that every PRD prompt should include.
 * Extracted so that improvements to task quality expectations propagate
 * everywhere at once.
 */
export const TASK_QUALITY_RULES = `Task quality:
- Task titles MUST be specific and actionable, verb-first (e.g. "Implement OAuth2 callback handler", NOT "OAuth2" or "Authentication stuff").
- Every task MUST have BOTH a description AND acceptanceCriteria. Omit neither.
- Descriptions explain the "why" and expected outcome — not just restating the title. Give enough context for someone unfamiliar with the codebase to understand the intent.
- Acceptance criteria MUST be concrete, verifiable pass/fail checks. Avoid subjective criteria like "works well" or "is fast".
- Each task should represent a single unit of work completable in one focused session (1-4 hours).
- Assign priority based on: blocking dependencies → user-facing impact → technical debt.`;

/**
 * Strict output format instruction shared by all PRD prompts.
 */
export const OUTPUT_INSTRUCTION = `Respond with ONLY a valid JSON array. No explanation, no markdown fences, no commentary — just the JSON.`;
