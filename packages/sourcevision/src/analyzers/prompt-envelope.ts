/**
 * Section vocabulary and assembly helpers for sourcevision's LLM prompts.
 *
 * The rationale is the same one recorded in rex's equivalent module: a prompt
 * built as one template literal has exactly one measurable number, so there is
 * no way to tell which part of it carries the cost and nothing for a rewrite to
 * aim at. Naming the parts makes {@link promptSectionCosts} able to say "the
 * archetype catalog is 60% of the classify prompt".
 *
 * sourcevision's prompts differ from rex's in shape — they are dominated by
 * generated context (zone file lists, crossing tables, the analysis document
 * being distilled) rather than by fixed instruction text — which is precisely
 * what the split makes visible. A rewrite that shortens instructions in a
 * prompt whose weight is 90% context is wasted effort, and until now there was
 * no number that would have said so.
 *
 * @see packages/rex/src/analyze/prompt-envelope.ts — the rex counterpart
 * @see packages/llm-client/src/prompt-diagnostics.ts — the shared measurement
 * @module sourcevision/analyzers/prompt-envelope
 */

import {
  createPromptEnvelope,
  assemblePromptText,
  promptSectionCosts,
  formatPromptSectionCosts,
  verbose,
} from "@n-dx/llm-client";
import type { PromptEnvelope, PromptSection, PromptSectionCost } from "@n-dx/llm-client";
import { DEFAULT_MODEL } from "./claude-client.js";

/**
 * The parts a sourcevision prompt is built from, in emission order.
 *
 * Shared across the enrichment, classification, and primer prompts so a
 * section's cost is comparable between them.
 */
export const SV_PROMPT_SECTIONS = [
  /** Opening instruction — what the model is being asked to produce. */
  "role",
  /** The repository's language/framework shape, when profiled. */
  "project-profile",
  /** Operator-supplied hints from `.n-dx.json`. */
  "hints",
  /** The zones, files, or analysis document under examination. */
  "input",
  /** A fixed enumeration the answer must choose from — e.g. the archetypes. */
  "catalog",
  /** Leading doc comments of the sampled files. */
  "file-headers",
  /** One-line summaries of zones outside the current batch. */
  "other-zones",
  /** The cross-zone import table. */
  "crossings",
  /** What a previous pass concluded. */
  "prior-pass",
  /** Note applying to the run as a whole rather than this batch. */
  "global-note",
  /** Rules constraining the answer. */
  "rules",
  /** Response shape and format contract. */
  "output",
] as const;

/** A section name from {@link SV_PROMPT_SECTIONS}. */
export type SvPromptSection = (typeof SV_PROMPT_SECTIONS)[number];

// ── Shared output contract ──────────────────────────────────────────────────
//
// Four enrichment builders across two files each spelled the response contract
// out for themselves, and they had already drifted: one asked for "ONLY a JSON
// object" where the others asked for "ONLY a JSON object (no markdown, no
// explanation)". `tryParseJSON` strips fences, so the divergence cost output
// tokens rather than breaking anything — which is exactly why nothing caught
// it. These prompts run per batch and per zone, so a contract written four ways
// is also four places to edit when the response shape changes.

/** Ask for a bare JSON object. Stated identically by every enrichment prompt. */
export const JSON_OBJECT_ONLY =
  "Respond with ONLY a JSON object (no markdown, no explanation):";

/** Later-pass rule: do not restate what the previous pass already found. */
export const ONLY_NEW_INSIGHTS =
  "Add ONLY NEW insights not already captured above. Do not repeat or rephrase existing observations.";

/**
 * The finding-shape line, in its two intended forms.
 *
 * Batch prompts name the `category` enum; the per-zone prompts do not. That is
 * a choice rather than an oversight — per-zone enrichment is the minimal
 * fallback path, and `classifyFinding` in enrich-parsing.ts derives a category
 * from the finding text whenever the model omits one, so asking for it there
 * would add tokens to the smallest prompts for a field the pipeline already
 * fills in.
 *
 * @param withCategory - include the category enum (batch prompts only)
 */
export function findingsContract(withCategory: boolean): string {
  const severity = 'Findings: severity ("info"|"warning"|"critical")';
  return withCategory
    ? `${severity}, category ("structural"|"code"|"documentation").`
    : `${severity}.`;
}

/**
 * Declare one prompt section.
 *
 * Accepts empty and `undefined` content so a conditional block is one entry in
 * the section list rather than a `let` accumulated above it;
 * {@link svPromptEnvelope} drops whatever is empty.
 */
export function section(
  name: SvPromptSection,
  content: string | undefined | null,
): PromptSection {
  return { name, content: content ?? "" };
}

/** Build an envelope, dropping sections with no content. */
export function svPromptEnvelope(
  sections: ReadonlyArray<PromptSection>,
): PromptEnvelope {
  return createPromptEnvelope(sections);
}

/**
 * Assemble an envelope into the single prompt string sourcevision sends.
 *
 * Every sourcevision LLM call goes through `callClaude(prompt)` — one string,
 * no separate system channel — so sections are emitted in declared order.
 */
export function svPrompt(
  envelope: PromptEnvelope,
  options?: { readonly separator?: string },
): string {
  return assemblePromptText(envelope, options);
}

/** Measure each section of a prompt envelope. */
export function svPromptCosts(
  envelope: PromptEnvelope,
  model: string = DEFAULT_MODEL,
): PromptSectionCost[] {
  return promptSectionCosts(envelope, model);
}

/**
 * Log a prompt's per-section token cost, most expensive section first.
 *
 * Routed through `verbose` so it appears under `--verbose`/`--debug` only —
 * enrichment can issue dozens of these per analysis.
 */
export function logSvPromptSections(
  label: string,
  envelope: PromptEnvelope,
  model: string = DEFAULT_MODEL,
): void {
  for (const line of formatPromptSectionCosts(svPromptCosts(envelope, model), { label })) {
    verbose(line);
  }
}
