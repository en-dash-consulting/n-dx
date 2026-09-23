/**
 * GlossaryLine — a one-line plain-language definition rendered under the
 * first field or column header on a page that uses a given term.
 *
 * The definition text itself lives in `glossary-terms.ts`; this
 * component only looks it up and renders it (or nothing, for a term the
 * glossary does not know). See that module's header for the full rationale.
 */

import { h } from "preact";
import { getGlossaryDefinition } from "./glossary-terms.js";

export interface GlossaryLineProps {
  /** Glossary term key, e.g. "zone" or "zone pin". */
  term: string;
  /** Element id, so a table or region can point at the line with aria-describedby. */
  id?: string;
  /**
   * Visual copy only: hidden from assistive technology. Use when the line
   * sits inside a table header cell, where a screen reader would repeat it
   * for every cell in the column, and expose the same text once elsewhere
   * (an `srOnly` line referenced by the table's aria-describedby).
   */
  decorative?: boolean;
  /** Visually hidden, read by assistive technology only (the `.sr-only` utility). */
  srOnly?: boolean;
}

export function GlossaryLine({ term, id, decorative, srOnly }: GlossaryLineProps) {
  const definition = getGlossaryDefinition(term);
  if (!definition) return null;
  return h(
    "p",
    {
      class: srOnly ? "sr-only" : "glossary-line",
      ...(id ? { id } : {}),
      ...(decorative ? { "aria-hidden": "true" } : {}),
    },
    definition,
  );
}
