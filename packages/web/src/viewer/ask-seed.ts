/**
 * The handoff that carries a finding from Problems/Suggestions into Ask.
 *
 * A findings row says *that* something is wrong. What it means for this
 * repository, and what fixing it would touch, is a question for the Ask panel —
 * and the panel needs the finding to answer it.
 *
 * ## Why a module slot rather than the route
 *
 * The other cross-view handoffs (`file`, `zone`, `runId`, `taskId`) are scalars
 * that go through {@link NavigateTo} and into route state, where they survive a
 * reload and a crash-recovery restore. A finding is a record — type, severity,
 * zone, message, and every file it touches — so putting it there would mean
 * widening `NavigateTo`, route state, and the crash snapshot to carry a
 * structure none of them are shaped for, and encoding it into a URL that no one
 * would want to share.
 *
 * So it goes in a one-slot channel instead: the findings surface leaves the
 * seed here and navigates, and the panel takes it on mount. Taking clears it —
 * an explanation is a single act, and a seed left behind would attach itself to
 * the next question the user typed by hand.
 *
 * The cost of that choice is that an explanation is not deep-linkable and does
 * not survive a reload. Both are acceptable: the seed is one click away from
 * the row that produced it.
 *
 * @module web/viewer/ask-seed
 * @see packages/web/src/viewer/views/ask.ts — takes the seed
 * @see packages/web/src/viewer/components/data-display/findings-list.ts — the row
 */

import type { Finding } from "./external.js";
import type { NavigateTo } from "./types.js";

/**
 * A finding, reduced to what an explanation needs.
 *
 * Structured on purpose. The endpoint could be handed a sentence naming the
 * zone, but then the model would be reading someone else's summary of the
 * finding rather than the finding — and every field it chose to leave out
 * would be invisible. Named fields also make the request assertable: a test can
 * check the zone and the files arrived, which is not true of prose.
 */
export interface FindingSeed {
  /** `anti-pattern`, `suggestion`, `pattern`, `relationship`. */
  type: string;
  /** `critical` / `warning` / `info`. Absent when the finding did not set one. */
  severity?: string;
  /** The zone the finding is scoped to, or `global`. */
  zone: string;
  /** The finding's own text. */
  message: string;
  /** Files the finding names. May be empty. */
  files: string[];
}

/**
 * Reduce a finding to its seed.
 *
 * `severity` is omitted rather than defaulted when the finding has none: the
 * list renders those as `info`, but telling the model a finding is "info" when
 * the analysis never said so would be inventing a fact about the codebase.
 */
export function findingToSeed(finding: Finding): FindingSeed {
  return {
    type: finding.type,
    ...(finding.severity ? { severity: finding.severity } : {}),
    zone: finding.scope || "global",
    message: finding.text,
    files: [...(finding.related ?? [])],
  };
}

/** The pending seed, or null when nothing is waiting to be explained. */
let pendingSeed: FindingSeed | null = null;

/** Leave a seed for the Ask panel to pick up on its next mount. */
export function setPendingAskSeed(seed: FindingSeed | null): void {
  pendingSeed = seed;
}

/**
 * Take the pending seed, clearing it.
 *
 * Consume-once: a seed that survived being read would silently attach itself to
 * the next question the user typed by hand, and they would have no way to see
 * why the answer kept talking about a finding they had moved on from.
 */
export function takePendingAskSeed(): FindingSeed | null {
  const seed = pendingSeed;
  pendingSeed = null;
  return seed;
}

/**
 * Explain `finding`: leave it for the panel, then go there.
 *
 * Lives here rather than in each view so the two findings surfaces cannot drift
 * apart on the order of those two steps — navigating first would race the
 * panel's mount against the seed being set.
 */
export function explainFinding(finding: Finding, navigateTo: NavigateTo): void {
  setPendingAskSeed(findingToSeed(finding));
  navigateTo("ask");
}

/**
 * The question asked alongside a seeded finding.
 *
 * The finding itself travels as structured context, so this says what kind of
 * answer is wanted rather than restating the finding. Both halves are demanded
 * explicitly because either one alone is a worse answer: what it means without
 * what to do is a lecture, and what to do without why it matters here is a
 * generic recipe that could have been written without reading the repository.
 */
export const EXPLAIN_FINDING_PROMPT =
  "Explain the finding above in plain language: what it means, why it matters " +
  "in this specific project — naming the zone and the files involved — and " +
  "what a fix would touch.";
