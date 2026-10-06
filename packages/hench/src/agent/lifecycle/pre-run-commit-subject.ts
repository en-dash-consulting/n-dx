/**
 * Deterministic commit subject for the pre-run commit gate.
 *
 * The gate commits changes that were *already in the tree* when the run
 * started — the operator's work in progress, not the agent's. Nothing in
 * this process knows what that work was for, and no amount of reading the
 * diff reliably recovers the intent: the honest subject names what changed
 * and says the commit is a checkpoint.
 *
 * That is why this can replace the model call it was written for
 * ({@link proposePreRunCommitMessage}). A model was being asked to
 * summarise someone else's unfinished work from a truncated diff, at the
 * cheapest tier available, and the result went straight to `git commit -m`
 * — which is why `commit-subject.ts` exists to strip the preambles and
 * fences that came back. Against that, a line computed from the file list
 * is not a downgrade; it is the same information without the round trip,
 * the credential dependency, the few seconds of latency before the prompt
 * appears, or the chance of "Sure, here you go:" entering the history.
 *
 * It also replaces a genuinely worse string. When the model call failed for
 * any reason — no provider, no credentials, a timeout, unusable output —
 * the gate fell back to the fixed
 * `"chore: commit local changes before hench run"`, which says nothing
 * about the change at all.
 *
 * ## What is and is not inferred
 *
 * The conventional-commit **type** is only inferred where the file list
 * proves it: an all-documentation change is `docs`, an all-test change is
 * `test`, everything else is `chore`. `feat` and `fix` are deliberately
 * never guessed — they are claims about intent, and a wrong one is worse
 * than a vague one, because it ends up in the changelog.
 *
 * The **scope** is the set of top-level areas touched, which for a monorepo
 * means package names. It is dropped rather than truncated when the change
 * is too broad for a scope to mean anything.
 *
 * @module hench/agent/lifecycle/pre-run-commit-subject
 */

import { COMMIT_SUBJECT_MAX_LENGTH } from "./commit-subject.js";

/**
 * Size for the summary tail; omitted when unknown.
 *
 * One combined figure rather than insertions and deletions separately,
 * because that is what `measureChangeMagnitude` reports — the same number
 * the gate prints and escalates on, so the subject cannot disagree with the
 * warning shown beside it.
 */
export interface SubjectCounts {
  linesChanged: number;
}

/** Directory prefixes that are containers, not areas — look one level deeper. */
const CONTAINER_DIRS = new Set(["packages", "apps", "services", "libs", "modules", "crates"]);

/** How many scopes are worth naming before the scope stops being a scope. */
const MAX_SCOPES = 3;

const DOC_FILE = /\.(md|mdx|rst|adoc|txt)$/i;
const DOC_DIR = /(^|\/)(docs?|documentation)(\/|$)/i;
const TEST_FILE = /(\.|-)(test|spec)\.[cm]?[jt]sx?$/i;
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)/i;

/** Normalise a porcelain path: forward slashes, no trailing slash, no quotes. */
function normalize(path: string): string {
  return path.trim().replace(/^"|"$/g, "").split("\\").join("/").replace(/\/+$/, "");
}

function isDoc(path: string): boolean {
  return DOC_FILE.test(path) || DOC_DIR.test(path);
}

function isTest(path: string): boolean {
  return TEST_FILE.test(path) || TEST_DIR.test(path);
}

/**
 * The conventional-commit type the file list actually supports.
 *
 * Exported for testing.
 */
export function inferCommitType(paths: string[]): "docs" | "test" | "chore" {
  if (paths.length === 0) return "chore";
  if (paths.every(isDoc)) return "docs";
  // Documentation alongside tests still reads as a test change; the reverse
  // (tests alongside source) does not, and falls through to chore.
  if (paths.every((p) => isTest(p) || isDoc(p)) && paths.some(isTest)) return "test";
  return "chore";
}

/**
 * The area each path belongs to: the first meaningful path segment, looking
 * through monorepo container directories so `packages/web/src/x.ts` is
 * `web` rather than `packages`.
 *
 * Exported for testing.
 */
export function inferScopes(paths: string[]): string[] {
  const scopes = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    if (segments.length === 1) {
      // A file at the repository root has no area of its own.
      scopes.add("root");
      continue;
    }
    const first = segments[0];
    if (CONTAINER_DIRS.has(first.toLowerCase()) && segments.length >= 2) {
      scopes.add(segments[1]);
    } else {
      scopes.add(first);
    }
  }
  return [...scopes].sort();
}

/**
 * Build the subject line.
 *
 * Falls back progressively rather than truncating mid-word: the scope goes
 * first when the line is too long, then the counts, leaving a short subject
 * that is still true.
 *
 * @param rawPaths Project-relative paths of every dirty file.
 * @param counts   Insertions/deletions against HEAD, when known.
 * @returns A single conventional-commit subject within
 *          {@link COMMIT_SUBJECT_MAX_LENGTH}.
 */
export function buildPreRunCommitSubject(
  rawPaths: readonly string[],
  counts?: SubjectCounts,
): string {
  const paths = rawPaths.map(normalize).filter((p) => p.length > 0);
  const type = inferCommitType(paths);
  const scopes = inferScopes(paths);

  const fileCount = paths.length;
  const filePart = fileCount === 1 ? "1 file" : `${fileCount} files`;
  const countPart =
    counts && counts.linesChanged > 0
      ? `, ${counts.linesChanged} line${counts.linesChanged === 1 ? "" : "s"}`
      : "";

  const scopePart = scopes.length > 0 && scopes.length <= MAX_SCOPES ? `(${scopes.join(",")})` : "";

  // Widest form first, then shed detail until it fits.
  const candidates = [
    `${type}${scopePart}: pre-run checkpoint, ${filePart}${countPart}`,
    `${type}${scopePart}: pre-run checkpoint, ${filePart}`,
    `${type}: pre-run checkpoint, ${filePart}${countPart}`,
    `${type}: pre-run checkpoint, ${filePart}`,
    `${type}: pre-run checkpoint`,
  ];
  for (const candidate of candidates) {
    if (candidate.length <= COMMIT_SUBJECT_MAX_LENGTH) return candidate;
  }
  // Unreachable in practice — the last candidate is 27 characters — but a
  // subject is going into history either way, so bound it rather than trust
  // the arithmetic above.
  return candidates[candidates.length - 1].slice(0, COMMIT_SUBJECT_MAX_LENGTH);
}
