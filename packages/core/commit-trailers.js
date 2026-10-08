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
 * `N-DX:` takes a free-form producer string. `N-DX-Item:` and `N-DX-Status:`
 * are emitted by the hench run loop; `N-DX-Status:` is consumed by
 * `rex backfill-commit-attribution`.
 *
 * `N-DX-Item:` carries the **item id**. It used to carry a dashboard permalink
 * (`<publicUrl>/#/rex/item/<id>`), which baked the writer's host — usually
 * `http://localhost:3117` — into permanent history and resolved to nothing on
 * any other machine. Readers accept both: `itemIdFromTrailer`
 * (`packages/rex/src/core/change-commits.ts`) unwraps a permalink to the same
 * id, so commits written before the change still attribute. Emit only the id.
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
 * Returns the `N-DX:` provenance line and the co-authorship line, separated by
 * a newline and with no trailing newline — callers join it to a subject with a
 * blank line, which is what git requires for trailers to be recognized.
 *
 * @param {string} producer  What produced the commit, e.g. `"export/dashboard"`.
 * @returns {string}
 */
export function buildTrailerBlock(producer) {
  return `N-DX: ${producer}\n${CO_AUTHORED_BY_TRAILER}`;
}

/**
 * Build a full commit message: subject, blank line, trailer block.
 *
 * @param {string} subject   Commit subject line.
 * @param {string} producer  What produced the commit, e.g. `"init/baseline"`.
 * @returns {string}
 */
export function buildCommitMessage(subject, producer) {
  return `${subject}\n\n${buildTrailerBlock(producer)}`;
}
