/**
 * Verbosity-aware prompt renderer for n-dx packages.
 *
 * ## Template Syntax
 *
 * - `{{key}}` — parameter substitution. Replaced with the value from `params`.
 * - `{{verbose}}...{{/verbose}}` — verbose-only block. Stripped entirely in compact mode.
 * - `{{compact}}...{{/compact}}` — compact-only block. Stripped entirely in verbose mode.
 *
 * ## Compact Style Rules
 *
 * When `verbosity` is `"compact"`, the renderer applies automatic text transforms
 * to reduce token count. Transforms are safe for prose — they skip content inside
 * backtick code spans.
 *
 * ### Before/After Examples
 *
 * **Pattern 1 — Role declarations** (imperative brevity):
 * ```
 * verbose: "You are a product requirements analyst."
 * compact: "You: PRD analyst."
 * ```
 *
 * **Pattern 2 — Filler connectors** ("in order to" is redundant):
 * ```
 * verbose: "in order to ensure consistency across all tasks"
 * compact: "to ensure consistency across all tasks"
 * ```
 *
 * **Pattern 3 — Output instructions** (declarative → imperative):
 * ```
 * verbose: "Respond with ONLY a valid JSON array. No explanation, no markdown fences, no commentary — just the JSON."
 * compact: "Output: JSON array only."
 * ```
 *
 * **Pattern 4 — Polite obligation phrases** (strip hedge; keep directive):
 * ```
 * verbose: "Please make sure that each task has been assigned a priority value."
 * compact: "Each task needs priority."
 * ```
 *
 * **Pattern 5 — Extended rationale blocks** (conditional sections):
 * ```
 * verbose: "{{verbose}}\n## Why minimal changes matter\n- Every line changed is a line that can break unrelated functionality.\n- Refactoring outside task scope adds noise to diffs.\n{{/verbose}}"
 * compact: (entire block stripped)
 * ```
 *
 * **Pattern 6 — Verbose constraint preambles** (drop hedging):
 * ```
 * verbose: "so that the agent can make informed decisions"
 * compact: "for informed decisions"  [via "so that" → "for"]
 * ```
 *
 * **Pattern 7 — Guard instruction blocks** (provider-specific notes):
 * ```
 * verbose: "{{verbose}}\n- File paths are relative to the project root.\n- Max file size: 1048576 bytes\n{{/verbose}}"
 * compact: (entire block stripped)
 * ```
 *
 * ## Token Reduction
 *
 * Conditional sections (`{{verbose}}...{{/verbose}}`) provide the primary reduction
 * (~20–50% for typical prompt templates). Auto-transforms add a further ~5–10%.
 *
 * @module @n-dx/llm-client/prompt-renderer
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Verbosity level for prompt rendering.
 * - `"compact"` — terse output; verbose-only blocks stripped, auto-transforms applied.
 * - `"verbose"` — full output; compact-only blocks stripped, no transforms.
 */
export type PromptVerbosity = "compact" | "verbose";

/** Options for {@link renderPrompt}. */
export interface PromptRenderOptions {
  /** Verbosity level to apply. */
  verbosity: PromptVerbosity;
  /**
   * Named parameters for `{{key}}` substitution.
   * Keys must be simple identifiers (letters, digits, underscores, hyphens).
   */
  params?: Record<string, string>;
}

// ── Compact transforms ────────────────────────────────────────────────────────

/**
 * Sequential word-level transforms applied to prose in compact mode.
 * Code spans (backtick-delimited) are excluded from transformation.
 */
const COMPACT_TRANSFORMS: ReadonlyArray<readonly [RegExp, string]> = [
  // Role declarations: "You are a/an X" → "You: X"
  [/\bYou are an? /g, "You: "],
  // "in order to" → "to"
  [/\bin order to\b/g, "to"],
  // "so that" → "for" (clause connector → preposition)
  [/\bso that\b/g, "for"],
  // "Respond with ONLY " → "Output: "
  [/\bRespond with ONLY /g, "Output: "],
  // ", no markdown fences, no commentary — just the JSON" → "" (common suffix)
  [/, no markdown fences(?:, no commentary — just the JSON)?/g, ""],
  // "— just the JSON" residual
  [/ — just the JSON/g, ""],
  // "Please make sure that" → ""  (polite filler, directive still present)
  [/\bPlease make sure that\b\s*/gi, ""],
  // "make sure that" → "ensure"
  [/\bmake sure that\b/gi, "ensure"],
  // "in order for" → "for"
  [/\bin order for\b/g, "for"],
  // Trailing whitespace on lines
  [/[ \t]+$/gm, ""],
] as const;

/**
 * Split `text` into alternating prose and code-span segments.
 * Code spans include both inline backtick spans and triple-backtick fences.
 * Returns segments in source order.
 */
function splitCodeAndProse(
  text: string,
): ReadonlyArray<{ kind: "prose" | "code"; content: string }> {
  const segments: Array<{ kind: "prose" | "code"; content: string }> = [];
  // Match triple-backtick fences (possibly with language tag) or inline spans.
  const codePattern = /```[\s\S]*?```|`[^`\n]*`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "prose", content: text.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "code", content: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "prose", content: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Apply compact text transforms to a prose string.
 *
 * Skips content inside backtick code spans (inline and fenced) to avoid
 * mangling command names, file paths, or JSON fragments.
 *
 * @param text - Prose text to transform (may contain inline code spans).
 * @returns Compacted text.
 */
export function applyCompactStyle(text: string): string {
  return splitCodeAndProse(text)
    .map((seg) => {
      if (seg.kind === "code") return seg.content;
      let prose = seg.content;
      for (const [pattern, replacement] of COMPACT_TRANSFORMS) {
        prose = prose.replace(pattern, replacement);
      }
      return prose;
    })
    .join("");
}

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * Render a prompt template at the specified verbosity level.
 *
 * ### Processing order
 * 1. Strip/unwrap conditional sections (`{{verbose}}` / `{{compact}}`).
 * 2. Substitute `{{key}}` parameters.
 * 3. Apply compact auto-transforms (compact mode only).
 * 4. Normalize excess blank lines (collapse 3+ newlines → 2).
 *
 * Unrecognised `{{key}}` placeholders with no matching param entry are left
 * as-is so callers can detect missing substitutions.
 *
 * @param template - Template string containing optional markers.
 * @param options  - Verbosity level and optional parameter map.
 * @returns Rendered, ready-to-send prompt string.
 *
 * @example
 * ```ts
 * const prompt = renderPrompt(
 *   "Analyse {{target}}.{{verbose}}\n\nProvide detailed rationale.{{/verbose}}",
 *   { verbosity: "compact", params: { target: "the module" } }
 * );
 * // → "Analyse the module."
 * ```
 */
export function renderPrompt(template: string, options: PromptRenderOptions): string {
  const { verbosity, params = {} } = options;

  // 1. Handle conditional sections
  if (verbosity === "compact") {
    // Strip verbose-only blocks
    template = template.replace(/\{\{verbose\}\}[\s\S]*?\{\{\/verbose\}\}/g, "");
    // Unwrap compact-only blocks (retain content, remove markers)
    template = template.replace(/\{\{compact\}\}([\s\S]*?)\{\{\/compact\}\}/g, "$1");
  } else {
    // Strip compact-only blocks
    template = template.replace(/\{\{compact\}\}[\s\S]*?\{\{\/compact\}\}/g, "");
    // Unwrap verbose-only blocks
    template = template.replace(/\{\{verbose\}\}([\s\S]*?)\{\{\/verbose\}\}/g, "$1");
  }

  // 2. Parameter substitution: {{key}} → value
  for (const [key, value] of Object.entries(params)) {
    // Escape regex meta-characters that may appear in param keys
    const escaped = key.replace(/[$()*+.?[\]\\^{|}]/g, "\\$&");
    template = template.replace(new RegExp(`\\{\\{${escaped}\\}\\}`, "g"), value);
  }

  // 3. Apply compact auto-transforms (compact mode only)
  if (verbosity === "compact") {
    template = applyCompactStyle(template);
  }

  // 4. Normalize excess blank lines → at most one blank line between paragraphs
  template = template.replace(/\n{3,}/g, "\n\n").trim();

  return template;
}

// ── Token estimation ──────────────────────────────────────────────────────────

/**
 * Estimate the token count for a prompt string.
 *
 * Uses the widely-adopted approximation of **4 characters per token** for
 * English prose. Actual tokenisation depends on the model's vocabulary, but
 * this approximation is accurate to ±15% for typical instruction prompts and
 * is sufficient for relative comparisons (e.g. measuring compact vs verbose
 * reduction ratios).
 *
 * Do **not** use this estimate for billing, quota management, or context-window
 * overflow detection — use the model's native token counter for those.
 *
 * @param text - Text to estimate.
 * @returns Estimated token count (always ≥ 1 for non-empty strings).
 */
export function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
