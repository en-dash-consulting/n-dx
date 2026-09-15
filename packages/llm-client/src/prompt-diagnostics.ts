/**
 * Per-section prompt measurement — the one mechanism every package uses.
 *
 * ## Why this is in the foundation tier
 *
 * Section-level measurement started in hench (`agent/lifecycle/prompt-diagnostics.ts`)
 * because hench was the only package that built a {@link PromptEnvelope}. rex and
 * sourcevision hold most of the monorepo's static prompt text and cannot import
 * hench — it sits an entire tier above them — so leaving the extractor there
 * meant either no measurement for the packages that needed it most, or a second
 * copy of it in each. Both are worse than moving the mechanism down to the layer
 * that already owns the envelope type.
 *
 * hench's `prompt-diagnostics.ts` now delegates here and keeps only its own CLI
 * rendering. The persisted diagnostic shape stays declared in hench's schema,
 * where the code that writes run records owns it.
 *
 * ## Two functions, deliberately
 *
 * {@link extractPromptSectionDiagnostics} returns names and byte lengths — the
 * shape hench persists on every run record, unchanged since it was introduced.
 * {@link promptSectionCosts} adds token estimates and each section's share of
 * the whole, which is what answers "which section is this prompt's cost?" and
 * therefore which one a rewrite should open first. Keeping them separate means
 * adding the cost view did not widen the shape stored in run records.
 *
 * @see packages/llm-client/src/runtime-contract.ts — PromptEnvelope, PromptSection
 * @see packages/hench/src/agent/lifecycle/prompt-diagnostics.ts — CLI rendering
 */

import type { PromptEnvelope } from "./runtime-contract.js";
import { budgetPreflight } from "./budget-preflight.js";

/**
 * Name and byte size of one envelope section.
 *
 * Byte length rather than character length: it is what a transport actually
 * carries, and it is the field hench has persisted on run records from the
 * start. Widening this interface changes a stored shape — add to
 * {@link PromptSectionCost} instead.
 */
export interface PromptSectionDiagnostic {
  /** Section name, as declared by the builder. */
  readonly name: string;
  /** Byte length of the section content (UTF-8). */
  readonly byteLength: number;
}

/**
 * A section's measured cost, for attributing a prompt's token bill to its parts.
 */
export interface PromptSectionCost extends PromptSectionDiagnostic {
  /** Character length of the section content. */
  readonly charLength: number;
  /** Estimated input tokens, from the runtime's own context-window estimator. */
  readonly tokenEstimate: number;
  /** This section's share of the envelope's total estimated tokens, 0–100. */
  readonly sharePercent: number;
}

/**
 * Extract name and byte size for every section in an envelope.
 *
 * Sections are reported in envelope order, which is assembly order — so the
 * diagnostics read in the same sequence the model does.
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
 * Measure every section's token cost and its share of the envelope total.
 *
 * Counts come from {@link budgetPreflight}, the same estimator the runtime uses
 * to decide whether a prompt fits a context window. Deliberately not a second
 * estimator: a per-section number has to add up to the number the runtime would
 * produce for the assembled prompt.
 *
 * `sharePercent` is computed against the sum of the section estimates rather
 * than against a fresh estimate of the joined text, so the shares always total
 * 100 and no section's share moves because of separator rounding.
 *
 * @param envelope - Sections to measure
 * @param model - Model id the estimate is for (affects nothing but provenance
 *   today, since the estimator is chars-per-token, but it keeps the call
 *   honest if that changes)
 */
export function promptSectionCosts(
  envelope: PromptEnvelope,
  model: string,
): PromptSectionCost[] {
  const measured = envelope.sections.map((section) => ({
    name: section.name,
    byteLength: Buffer.byteLength(section.content, "utf8"),
    charLength: section.content.length,
    tokenEstimate: budgetPreflight(model, section.content.length).tokenEstimate,
  }));

  const total = measured.reduce((sum, s) => sum + s.tokenEstimate, 0);

  return measured.map((s) => ({
    ...s,
    sharePercent: total === 0 ? 0 : (s.tokenEstimate / total) * 100,
  }));
}

/**
 * Order sections by token cost, most expensive first.
 *
 * The ordering a rewrite wants: it names the section to open first. Envelope
 * order is the ordering a reader wants, which is why
 * {@link promptSectionCosts} preserves it and this is a separate step.
 */
export function dominantPromptSections(
  costs: ReadonlyArray<PromptSectionCost>,
): PromptSectionCost[] {
  return [...costs].sort((a, b) => b.tokenEstimate - a.tokenEstimate);
}

/**
 * Render measured sections as display lines, most expensive first.
 *
 * Returns lines rather than printing them — this module is in the foundation
 * tier and must not choose an output channel for its callers. rex prints these
 * through its own `info`, hench through `detail`.
 */
export function formatPromptSectionCosts(
  costs: ReadonlyArray<PromptSectionCost>,
  options?: { readonly label?: string; readonly indent?: string },
): string[] {
  const indent = options?.indent ?? "  ";
  const totalTokens = costs.reduce((sum, c) => sum + c.tokenEstimate, 0);
  const label = options?.label ? `${options.label}: ` : "";

  const lines = dominantPromptSections(costs).map(
    (c) =>
      `${indent}${c.name}: ${c.tokenEstimate} tokens (${c.sharePercent.toFixed(1)}%)`,
  );

  lines.push(
    `${indent}${label}${totalTokens} tokens across ${costs.length} section${costs.length === 1 ? "" : "s"}`,
  );

  return lines;
}
