/**
 * GlossaryLine — a one-line plain-language definition rendered under the
 * first field or column header on a page that uses a given term.
 *
 * The definition text itself lives in `src/shared/glossary.ts`; this
 * component only looks it up and renders it (or nothing, for a term the
 * glossary does not know). See that module's header for the full rationale.
 */

import { h } from "preact";
import { getGlossaryDefinition } from "../external.js";

export interface GlossaryLineProps {
  /** Glossary term key, e.g. "zone" or "zone pin". */
  term: string;
}

export function GlossaryLine({ term }: GlossaryLineProps) {
  const definition = getGlossaryDefinition(term);
  if (!definition) return null;
  return h("p", { class: "glossary-line" }, definition);
}
