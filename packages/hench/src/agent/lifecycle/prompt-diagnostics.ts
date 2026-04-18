/**
 * Prompt section diagnostics — extract and log envelope section metadata.
 *
 * Provides observability into prompt composition by capturing section names
 * and byte sizes from a {@link PromptEnvelope}. The extracted diagnostics
 * are:
 * 1. Logged to the CLI output (via `detail`) during prompt construction
 * 2. Stored on the {@link RunDiagnostics.promptSections} field for post-hoc analysis
 *
 * This module is consumed by `cli-loop.ts` after `buildSpawnConfig()`.
 *
 * @see packages/hench/src/schema/v1.ts — PromptSectionDiagnostic, RunDiagnostics
 * @see packages/llm-client/src/runtime-contract.ts — PromptEnvelope, PromptSection
 */

import type { PromptEnvelope } from "../../prd/llm-gateway.js";
import type { PromptSectionDiagnostic } from "../../schema/index.js";
import { detail } from "../../types/output.js";

/**
 * Extract diagnostic metadata from a prompt envelope.
 *
 * Returns an array of {@link PromptSectionDiagnostic} objects, one per
 * section in the envelope. Each entry captures the section name and its
 * content byte length (UTF-8 via `Buffer.byteLength`).
 *
 * @param envelope - The prompt envelope to extract diagnostics from
 * @returns Array of section diagnostics (name + byteLength)
 */
export function extractPromptSectionDiagnostics(
  envelope: PromptEnvelope,
): PromptSectionDiagnostic[] {
  return envelope.sections.map((section) => ({
    name: section.name,
    byteLength: Buffer.byteLength(section.content, "utf8"),
  }));
}

/**
 * Log prompt section diagnostics to the CLI output.
 *
 * Emits one `detail` line per section showing the section name and byte size.
 * Includes a total byte count at the end. Suppressed in quiet mode (since
 * `detail` respects the global quiet flag).
 *
 * @param sections - Section diagnostics to log (from {@link extractPromptSectionDiagnostics})
 */
export function logPromptSections(sections: ReadonlyArray<PromptSectionDiagnostic>): void {
  for (const s of sections) {
    detail(`  prompt section "${s.name}": ${s.byteLength} bytes`);
  }
  const total = sections.reduce((sum, s) => sum + s.byteLength, 0);
  detail(`  prompt total: ${total} bytes (${sections.length} sections)`);
}
