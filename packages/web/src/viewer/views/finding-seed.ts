/**
 * Map a SourceVision finding onto an Ask seed.
 *
 * The Problems and Suggestions views both offer "Explain" on a finding row and
 * both need the same translation, so it lives here rather than twice in the
 * views or once inside `FindingsList` — which renders findings for the
 * Architecture view too and has no business knowing what Ask is.
 *
 * ## Facts, not prose
 *
 * The seed carries the finding's fields as fields. Flattening them into a
 * sentence ("Explain this critical anti-pattern in web-viewer: ...") would
 * make the panel's textarea the carrier of the context, so editing the
 * question — the obvious next thing a user does — would delete the grounding
 * along with it. Keeping them separate means the question is the user's and
 * the facts are the finding's.
 *
 * `severity` is omitted rather than defaulted when the analysis did not set
 * one. The list view defaults a missing severity to "info" for grouping, but
 * telling the model a finding is informational when nothing classified it that
 * way invents a fact — and severity is exactly the field an explanation
 * reasons about.
 *
 * @module web/viewer/views/finding-seed
 * @see ../types.ts — the AskSeed shape
 * @see ../../server/sourcevision-ask-context.ts — how a seed is rendered
 */

import type { Finding } from "../external.js";
import type { AskSeed } from "../types.js";
import { findingKey } from "../components/data-display/findings-list.js";

/** The surface name the endpoint records for a seed built here. */
export const FINDING_SEED_KIND = "finding";

/**
 * The question the panel is pre-filled with.
 *
 * Short and editable on purpose: it is the user's question, not the context.
 * Everything the answer must be grounded in travels in the seed beside it, so
 * rewording or replacing this line costs nothing.
 */
export const EXPLAIN_PROMPT = "Explain this finding in plain language.";

/** Build the Ask seed for one finding row. */
export function findingAskSeed(finding: Finding): AskSeed {
  const labels: Record<string, string> = { type: finding.type };
  if (finding.severity) labels["severity"] = finding.severity;

  const seed: AskSeed = {
    kind: FINDING_SEED_KIND,
    id: findingKey(finding),
    text: finding.text,
    labels,
  };

  // `scope` is "global" or a zone ID, and the distinction matters to the
  // answer: a global finding has no zone to name, and claiming one would be
  // the generic advice this feature exists to avoid.
  if (finding.scope && finding.scope !== "global") seed.zone = finding.scope;

  const files = (finding.related ?? []).filter((entry) => entry.trim().length > 0);
  if (files.length > 0) seed.files = files;

  return seed;
}
