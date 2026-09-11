/**
 * Section vocabulary and assembly helpers for rex's LLM prompts.
 *
 * ## Why rex prompts are sectioned
 *
 * Every prompt in `analyze/` used to be one large template literal with
 * interpolated constants and hand-rolled `\n${maybeBlock}` padding for the
 * conditional parts. That reads acceptably and measures not at all: the only
 * number available for a 3,000-token prompt was 3,000, so there was no way to
 * say which third of it was the schema, which the few-shot example, and which
 * the caller's actual input. A rewrite aimed at reducing prompt cost had
 * nothing to aim at.
 *
 * Naming the parts fixes that. {@link promptSectionCosts} attributes the token
 * bill to each section, so "this prompt is expensive" becomes "the few-shot
 * example is 40% of this prompt".
 *
 * ## The vocabulary is shared on purpose
 *
 * Sixteen builders across ten files emit substantially the same parts in
 * substantially the same order. Naming them from one list — rather than letting
 * each builder invent labels — is what makes the per-section numbers
 * comparable: `schema` costs the same in every prompt that includes it, and the
 * cost report can total a section across the whole package.
 *
 * ## Assembly is separator-driven
 *
 * {@link assemblePromptText} trims each section and joins with a blank line.
 * That is the same output the template literals produced, which is why the
 * migration onto envelopes changed no prompt text — the padding a conditional
 * block used to carry itself is now supplied by the separator, and a block
 * that is absent costs nothing rather than leaving a doubled blank line.
 *
 * @see packages/llm-client/src/runtime-contract.ts — PromptEnvelope, assemblePromptText
 * @see packages/rex/tests/unit/analyze/prompt-text-identity.test.ts — the identity proof
 * @module rex/analyze/prompt-envelope
 */

import {
  createPromptEnvelope,
  assemblePromptText,
  promptSectionCosts,
  formatPromptSectionCosts,
  verbose,
} from "@n-dx/llm-client";
import type { PromptEnvelope, PromptSection, PromptSectionCost } from "@n-dx/llm-client";
import { DEFAULT_MODEL } from "./analyze-shared.js";

/**
 * The parts a rex PRD prompt is built from, in the order they are emitted.
 *
 * Ordering matters twice over: it is the order the model reads, and it is the
 * order the cost report lists, so a reader can see where a prompt's weight sits
 * without reordering anything in their head.
 */
export const REX_PROMPT_SECTIONS = [
  /** Opening instruction — who the model is and what it is being asked for. */
  "role",
  /** The PRD JSON shape the response must match. */
  "schema",
  /** Worked example of a well-formed response. */
  "example",
  /** Guidance toward fewer, larger work packages. */
  "consolidation",
  /** Baseline-scan instruction — mark already-built work as completed. */
  "baseline",
  /** How to turn this particular input into a hierarchy. */
  "structure",
  /** Shared task-quality expectations. */
  "quality",
  /** Rules specific to the input kind (scan results, rough notes, …). */
  "input-rules",
  /** Do-not-duplicate rules. */
  "dedup",
  /** Mistakes to avoid. */
  "anti-patterns",
  /** Where new items belong — parent constraint or auto-placement. */
  "placement",
  /** Hint about the input document's format. */
  "format-hint",
  /** Note about which chunk of a split input this call covers. */
  "chunk-note",
  /** Project documentation, for domain terminology. */
  "project-context",
  /** Summary of the PRD as it stands. */
  "existing-prd",
  /** The caller's actual input — document, description, proposals, notes. */
  "input",
  /** Response-format contract. */
  "output",
  /** Appended on a retry: what the previous response got wrong. */
  "retry",
] as const;

/** A section name from {@link REX_PROMPT_SECTIONS}. */
export type RexPromptSection = (typeof REX_PROMPT_SECTIONS)[number];

/**
 * Declare one prompt section.
 *
 * Accepts `undefined` and empty content so a conditional block reads as one
 * entry in the section list rather than as a mutable `let` assembled above it.
 * {@link rexPromptEnvelope} drops whatever is empty.
 */
export function section(
  name: RexPromptSection,
  content: string | undefined | null,
): PromptSection {
  return { name, content: content ?? "" };
}

/**
 * Build an envelope, dropping sections with no content.
 *
 * Thin wrapper over {@link createPromptEnvelope} that fixes the section-name
 * type to rex's vocabulary — a typo in a section name would otherwise be
 * accepted silently by the open `PromptSectionName` type and quietly split one
 * section's measured cost into two.
 */
export function rexPromptEnvelope(
  sections: ReadonlyArray<PromptSection>,
): PromptEnvelope {
  return createPromptEnvelope(sections);
}

/**
 * Assemble an envelope into the single prompt string rex sends to a model.
 *
 * rex reaches every vendor through one `complete({ prompt })` call, so there is
 * no separate system channel to route a section into and section order is
 * preserved exactly as declared.
 */
export function rexPrompt(
  envelope: PromptEnvelope,
  options?: { readonly separator?: string },
): string {
  return assemblePromptText(envelope, options);
}

/**
 * Measure each section of a prompt envelope.
 *
 * @param envelope - The envelope to measure
 * @param model - Model the estimate is for; defaults to rex's own default model
 */
export function rexPromptCosts(
  envelope: PromptEnvelope,
  model: string = DEFAULT_MODEL,
): PromptSectionCost[] {
  return promptSectionCosts(envelope, model);
}

/**
 * Log a prompt's per-section token cost, most expensive section first.
 *
 * Routed through `verbose` so it surfaces under `--verbose`/`--debug` and stays
 * out of the way otherwise — the same posture hench's equivalent takes with
 * `detail`.
 */
export function logRexPromptSections(
  label: string,
  envelope: PromptEnvelope,
  model: string = DEFAULT_MODEL,
): void {
  for (const line of formatPromptSectionCosts(rexPromptCosts(envelope, model), { label })) {
    verbose(line);
  }
}
