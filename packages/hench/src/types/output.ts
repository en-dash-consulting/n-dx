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
export { setQuiet, isQuiet, info, result } from "@n-dx/llm-client";

import { isQuiet } from "@n-dx/llm-client";

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
  console.log(`\n${rule}\n❯ ${title}\n${rule}`);
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
  console.log(`\n${prefix}${"─".repeat(pad)}`);
}

/**
 * Print a labelled streaming line. Suppressed in quiet mode.
 * The label is right-padded for alignment.
 *
 *   [Agent]   Some agent text…
 *   [Tool]    read_file({"path":"…"})
 *   [Result]  contents of file…
 */
export function stream(label: string, text: string): void {
  if (isQuiet()) return;
  const tag = `[${label}]`.padEnd(10);
  console.log(`  ${tag} ${text}`);
}

/**
 * Print a dim/secondary detail line. Suppressed in quiet mode.
 * Useful for metadata like timing, token counts, retry info.
 */
export function detail(text: string): void {
  if (isQuiet()) return;
  console.log(`           ${text}`);
}
