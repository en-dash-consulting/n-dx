/**
 * Commit trailers for commits that n-dx creates on the user's behalf.
 *
 * Every commit n-dx produces should say two things: that n-dx produced it, and
 * what inside n-dx produced it. The `Co-Authored-By` line is what routes the
 * commit to the n-dx identity — `packages/web/src/server/merge-history.ts`
 * parses it (`COAUTHOR_RE`) to attribute commits in the dashboard's merge graph,
 * and GitHub reads it for the contribution graph. A commit without it is
 * invisible to both, silently: nothing fails, the attribution just never
 * appears.
 *
 * ## The `N-DX*` trailer namespace
 *
 * One namespace, three keys, each with a distinct meaning. They are not
 * variants of each other and should not be unified:
 *
 * | Trailer         | Answers                  | Example                                  |
 * |-----------------|--------------------------|------------------------------------------|
 * | `N-DX:`         | what produced the commit | `skill/ndx-capture`, `claude/opus · run 1f3` |
 * | `N-DX-Item:`    | which PRD item it is for | `5ee70ad3-313d-46f0-b99c-592d5e49dc74`   |
 * | `N-DX-Status:`  | what status changed      | `<taskId> in_progress → completed`       |
 *
 * `N-DX:` takes a free-form producer string. `N-DX-Status:` is emitted by the
 * hench run loop. `rex backfill-commit-attribution` reads both `N-DX-Item:` and
 * `N-DX-Status:` to report how much of history carries neither.
 *
 * `N-DX-Item:` carries the **item id**. It used to carry a dashboard permalink
 * (`<publicUrl>/#/rex/item/<id>`), which baked the writer's host — usually
 * `http://localhost:3117` — into permanent history and resolved to nothing on
 * any other machine. Readers accept both: `itemIdFromTrailer`
 * (`packages/rex/src/core/change-commits.ts`) unwraps a permalink to the same
 * id, so commits written before the change still attribute. Emit only the id.
 *
 * ## When to emit `N-DX-Item:` — the one-item rule
 *
 * **A commit emits `N-DX-Item` when it is for exactly one PRD item.** It is
 * how rex's realized-by edge finds the commits that realize an item
 * (`computeChangeCommits` reads the trailer and nothing else — not the subject,
 * which no reader parses), so an implementation commit without it is invisible
 * to the evidence layer.
 *
 * A commit that spans several items emits none: naming one of the N would
 * attribute the whole commit to it. That rules out hench's `--reset-deferred`
 * commit, and the `ndx-plan` / `ndx-reshape` / `ndx-adversarial-review` skills,
 * each of which writes a batch. A commit for no item at all — hench's pre-run
 * gate commit, and every path in this module — emits none either.
 *
 * Core's own three commit paths (`ndx init`'s baseline, `ndx export`'s
 * dashboard deploy, `ndx migrate-layout`'s move) are repository-level: they
 * exist before or outside any PRD item, so none passes an `itemId` today. The
 * parameter exists so a core path that *is* for an item emits the trailer in
 * the same shape as hench's and the skills' rather than inventing a third;
 * `tests/unit/commit-trailers.test.js` pins both halves.
 *
 * ## Why this string is duplicated
 *
 * hench has its own copy in `buildCoAuthoredByTrailerLine()`
 * (`packages/hench/src/agent/lifecycle/shared.ts`). It cannot be shared: core is
 * the orchestration tier and must not import from packages, so the duplication
 * is forced by the architecture rather than by oversight. The two strings are
 * asserted byte-identical in `tests/e2e/skill-commit-isolation.test.js` so the
 * copies cannot drift apart unnoticed.
 *
 * @module n-dx/commit-trailers
 */

/**
 * The co-authorship trailer line appended to every n-dx-generated commit.
 *
 * Must stay byte-identical to hench's `buildCoAuthoredByTrailerLine()`.
 *
 * @type {string}
 */
export const CO_AUTHORED_BY_TRAILER = "Co-Authored-By: En Dash's n-dx <n-dx@endash.us>";

/**
 * Build the trailer block for a commit n-dx is about to create.
 *
 * Returns the `N-DX:` provenance line, an `N-DX-Item:` line when the commit is
 * for exactly one item, and the co-authorship line — separated by newlines and
 * with no trailing newline, and with no blank line between them. Callers join
 * the block to a subject with a blank line, which is what git requires for
 * trailers to be recognized; a blank line *inside* the block would end it and
 * leave the rest as body text.
 *
 * @param {string} producer  What produced the commit, e.g. `"export/dashboard"`.
 * @param {string} [itemId]  The PRD item this commit is for, when it is for
 *   exactly one. Omit for a repository-level commit or one spanning several
 *   items — see the one-item rule in this module's header.
 * @returns {string}
 */
export function buildTrailerBlock(producer, itemId) {
  const item = itemId ? `N-DX-Item: ${itemId}\n` : "";
  return `N-DX: ${producer}\n${item}${CO_AUTHORED_BY_TRAILER}`;
}

/**
 * Build a full commit message: subject, blank line, trailer block.
 *
 * @param {string} subject   Commit subject line.
 * @param {string} producer  What produced the commit, e.g. `"init/baseline"`.
 * @param {string} [itemId]  The PRD item this commit is for, when it is for
 *   exactly one.
 * @returns {string}
 */
export function buildCommitMessage(subject, producer, itemId) {
  return `${subject}\n\n${buildTrailerBlock(producer, itemId)}`;
}
