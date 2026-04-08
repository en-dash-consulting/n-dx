/**
 * CLI output control — supports --quiet mode for scripting
 * and structured section headers for streaming agent output.
 *
 * Core primitives (setQuiet, isQuiet, info, result) are shared from
 * @n-dx/llm-client. Hench-specific extensions (section, subsection,
 * stream, detail) are defined here and use the shared isQuiet() state.
 *
 * This module is placed in types/ to avoid circular dependencies
 * between CLI and agent modules (both need output formatting).
 *
 * In quiet mode, only essential output is emitted:
 * - JSON output (--format=json)
 * - Error messages (always via console.error)
 * - Final result identifiers (e.g. run IDs, status)
 *
 * Informational messages (progress, hints, summaries) are suppressed.
 */

// Re-export shared foundation primitives.
export { setQuiet, isQuiet, info, result } from "../prd/llm-gateway.js";

import { isQuiet, bold, cyan, dim, colorDim, colorWarn, colorInfo } from "../prd/llm-gateway.js";

// ---------------------------------------------------------------------------
// Streaming output — section headers and labelled lines for agent runs
// ---------------------------------------------------------------------------

const SECTION_WIDTH = 60;

/**
 * Print a major section header. Suppressed in quiet mode.
 *
 *   ══════════════════════════════════════════════════════════════
 *   ❯ Section Title
 *   ══════════════════════════════════════════════════════════════
 */
export function section(title: string): void {
  if (isQuiet()) return;
  const rule = "═".repeat(SECTION_WIDTH);
  console.log(`\n${cyan(rule)}\n${bold(`❯ ${title}`)}\n${cyan(rule)}`);
}

/**
 * Print a minor subsection header. Suppressed in quiet mode.
 *
 *   ── Subsection Title ──────────────────────────────────────────
 */
export function subsection(title: string): void {
  if (isQuiet()) return;
  const prefix = `── ${title} `;
  const pad = Math.max(0, SECTION_WIDTH - prefix.length);
  console.log(`\n${bold(prefix)}${dim("─".repeat(pad))}`);
}

/**
 * Color mapping for source-attribution prefix labels in stream output.
 *
 * - Tool:   dim/grey  — secondary, operational tag
 * - Agent:  yellow    — primary agent voice
 * - Vendor/model names (Codex, claude, …): cyan/blue — origin identifier
 *
 * Labels not listed here render without color.
 * Color helpers are evaluated at call time, so TTY and NO_COLOR detection
 * is honoured automatically via the shared llm-client isColorEnabled() logic.
 */
const STREAM_LABEL_COLORS: Readonly<Record<string, (text: string) => string>> = {
  Tool:   colorDim,
  Agent:  colorWarn,
  Codex:  colorInfo,
  claude: colorInfo,
};

/**
 * Print a labelled streaming line. Suppressed in quiet mode.
 * The label is right-padded for alignment and color-coded by source type.
 *
 *   [Agent]   Some agent text…
 *   [Tool]    read_file({"path":"…"})
 *   [Result]  contents of file…
 */
export function stream(label: string, text: string): void {
  if (isQuiet()) return;
  const bracket = `[${label}]`;
  const colorFn = STREAM_LABEL_COLORS[label];
  const coloredBracket = colorFn ? colorFn(bracket) : bracket;
  const padding = " ".repeat(Math.max(0, 10 - bracket.length));
  console.log(`  ${coloredBracket}${padding} ${text}`);
}

/**
 * Print a dim/secondary detail line. Suppressed in quiet mode.
 * Useful for metadata like timing, token counts, retry info.
 */
export function detail(text: string): void {
  if (isQuiet()) return;
  console.log(dim(`           ${text}`));
}
