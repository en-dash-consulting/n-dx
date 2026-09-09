/**
 * Handing a finding from the Problems/Suggestions surfaces to the Ask panel.
 *
 * ## Why a hand-off store and not a route parameter
 *
 * The seed is structured — type, severity, zone, message, files — and the
 * files list can run to dozens of paths. Serialising that into a URL would
 * hit length limits, and round-tripping it through the address bar would
 * make a stale link replay a finding that may no longer exist in the
 * analysis. `NavigateTo`'s option bag carries scalar selections (`file`,
 * `zone`, `taskId`) for exactly the cases where a deep link *should*
 * survive a reload; an Explain click is not one of them.
 *
 * So the seed is a one-shot hand-off: the surface sets it, navigates, and
 * the Ask panel takes it. Taking clears it, so a later visit to the panel
 * does not silently re-ask the last finding — the failure mode a plain
 * "current seed" variable would have.
 *
 * A page reload between the click and the panel mounting loses the seed and
 * the panel opens empty. That is the honest outcome: the alternative is
 * persisting analysis-derived state that the next `ndx analyze` may
 * invalidate.
 *
 * @module web/viewer/ask-seed
 * @see packages/web/src/server/ask-context.ts — the server-side seed contract
 */

import type { Finding } from "./external.js";

/**
 * Structured seed context for a directed ask.
 *
 * Mirrors `AskSeed` in `server/ask-context.ts`. Re-declared rather than
 * imported because the server/viewer boundary forbids a viewer file from
 * reaching into `src/server/`; the endpoint validates every field, so a
 * drift between the two shapes fails loudly at the request rather than
 * silently dropping context.
 */
export interface AskSeed {
  kind: "finding" | "zone" | "file";
  id?: string;
  type?: string;
  severity?: string;
  zone?: string;
  message?: string;
  files?: string[];
}

/**
 * Project a finding onto a seed.
 *
 * Two mappings are worth stating. `scope` is the finding's zone, but the
 * literal string `"global"` is a sentinel meaning "not zone-scoped" — sent
 * as a zone it would have the model looking for a zone by that name and
 * finding none. And `severity` is genuinely optional in the schema, so an
 * unset severity is omitted rather than defaulted to `info`: the list
 * renders those as info, but claiming a severity the analysis never
 * assigned would put words in the finding's mouth.
 */
export function findingToAskSeed(finding: Finding): AskSeed {
  const seed: AskSeed = { kind: "finding", type: finding.type };

  if (finding.severity) seed.severity = finding.severity;
  if (finding.scope && finding.scope !== "global") seed.zone = finding.scope;
  if (finding.text?.trim()) seed.message = finding.text.trim();

  const files = (finding.related ?? []).filter((f) => typeof f === "string" && f.trim());
  if (files.length > 0) seed.files = files;

  return seed;
}

/** The seed awaiting collection, if a surface has just handed one over. */
let pending: AskSeed | null = null;

/** Hand a seed to the Ask panel. Overwrites any uncollected one. */
export function setPendingAskSeed(seed: AskSeed): void {
  pending = seed;
}

/**
 * Collect the pending seed, clearing it.
 *
 * Clearing on read is the point: without it, navigating back to the Ask
 * panel later would re-ask the last finding the user clicked Explain on.
 */
export function takePendingAskSeed(): AskSeed | null {
  const seed = pending;
  pending = null;
  return seed;
}

/** Whether a seed is waiting, without collecting it. */
export function hasPendingAskSeed(): boolean {
  return pending !== null;
}

/** Drop any pending seed. For teardown between tests. */
export function clearPendingAskSeed(): void {
  pending = null;
}

/**
 * The question that accompanies a finding seed.
 *
 * Short and fixed on purpose. The finding's specifics travel in the seed,
 * where the endpoint can validate them and the prompt builder can render
 * them; interpolating them into English here would make the client the
 * author of the explanation's framing, which is what the structured seed
 * exists to avoid.
 */
export const EXPLAIN_FINDING_PROMPT = "Explain this finding.";
