/**
 * Prompt section diagnostics — log envelope section metadata to hench's CLI.
 *
 * Provides observability into prompt composition by capturing section names
 * and byte sizes from a {@link PromptEnvelope}. The extracted diagnostics
 * are:
 * 1. Logged to the CLI output (via `detail`) during prompt construction
 * 2. Stored on the {@link RunDiagnostics.promptSections} field for post-hoc analysis
 *
 * This module is consumed by `cli-loop.ts` after `buildSpawnConfig()`.
 *
 * ## Where the extraction lives
 *
 * {@link extractPromptSectionDiagnostics} is re-exported from
 * `@n-dx/llm-client` rather than implemented here. It began as hench-local
 * code, which was fine while hench was the only package building a
 * `PromptEnvelope`; once rex and sourcevision adopted the envelope it stopped
 * working, because they sit a tier below hench and cannot import from it. The
 * choice was one implementation in the foundation tier or three copies, and
 * the copies would have drifted.
 *
 * What stays here is the part that is genuinely hench's: rendering to hench's
 * own `detail` channel in hench's own format, which `hench show` and the
 * run-record schema both depend on.
 *
 * @see packages/llm-client/src/prompt-diagnostics.ts — the shared extractor
 * @see packages/hench/src/schema/v1.ts — PromptSectionDiagnostic, RunDiagnostics
 * @see packages/llm-client/src/runtime-contract.ts — PromptEnvelope, PromptSection
 */

import type { PromptSectionDiagnostic } from "../../schema/index.js";
import { detail } from "../../types/output.js";

export { extractPromptSectionDiagnostics } from "../../prd/llm-gateway.js";

/**
 * Log prompt section diagnostics to the CLI output.
 *
 * Emits one `detail` line per section showing the section name and byte size.
 * Includes a total byte count at the end. Suppressed in quiet mode (since
 * `detail` respects the global quiet flag).
 *
 * @param sections - Section diagnostics to log (from `extractPromptSectionDiagnostics`)
 */
export function logPromptSections(sections: ReadonlyArray<PromptSectionDiagnostic>): void {
  for (const s of sections) {
    detail(`  prompt section "${s.name}": ${s.byteLength} bytes`);
  }
  const total = sections.reduce((sum, s) => sum + s.byteLength, 0);
  detail(`  prompt total: ${total} bytes (${sections.length} sections)`);
}
