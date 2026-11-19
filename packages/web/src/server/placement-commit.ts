/**
 * Commit the PRD files a best-guess placement rewrote.
 *
 * "Place best guesses" and a row's Accept (`POST /api/rex/changes/place-best`)
 * move each placed change's folder out of the Inbox and rewrite its state. The
 * route follows the write with one commit of exactly those files, so a batch
 * placement lands as a reviewable commit instead of a pile of renames in the
 * git panel.
 *
 * The same properties as the settings commit (`settings-commit.ts`):
 *
 * - **Scoped.** Only the files the PRD transaction reported (`written` and
 *   `deletedFiles`) are staged and committed, by a pathspec, so the operator's
 *   own work elsewhere — staged or not, PRD or not — is left alone. A partial
 *   commit is refused mid-merge, which is the right outcome.
 * - **Fixed shape.** A constant subject per kind, a body naming each change
 *   and where it went, and the usual trailers: `N-DX: web/place-best`, an
 *   `N-DX-Item` per placed change, and the n-dx co-author.
 * - **Never pushes.**
 *
 * A failed commit never fails the placement: the PRD write already happened.
 * The outcome is returned so the route can say "not committed" and why.
 *
 * @module web/server/placement-commit
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { exec } from "@n-dx/llm-client";

/** One placement the commit records. */
export interface CommittedPlacement {
  change: string;
  changeTitle: string;
  targetTitle: string;
}

/** What the commit did: its short sha, or why there was none. */
export type PlacementCommit = { sha: string } | { skipped: string };

/** Files a PRD transaction touched, relative to the rex directory. */
export interface TouchedPrdFiles {
  written: readonly string[];
  deletedFiles: readonly string[];
}

const TRAILER_TAG = "N-DX: web/place-best";
const CO_AUTHOR = "Co-Authored-By: En Dash's n-dx <n-dx@endash.us>";

/** Subject: one change by name, or a count. */
export function placementSubject(placed: readonly CommittedPlacement[]): string {
  if (placed.length === 1) {
    const [p] = placed;
    return `chore(prd): place "${p.changeTitle}" on ${p.targetTitle}`;
  }
  return `chore(prd): place ${placed.length} Inbox changes on their best guess`;
}

/** The whole message: subject, one body line per change, then one trailer block. */
export function placementMessage(placed: readonly CommittedPlacement[]): string {
  const body = placed.length > 1
    ? placed.map((p) => `- ${p.changeTitle} → ${p.targetTitle}`).join("\n") + "\n\n"
    : "";
  const trailers = [TRAILER_TAG, ...placed.map((p) => `N-DX-Item: ${p.change}`), CO_AUTHOR].join("\n");
  return `${placementSubject(placed)}\n\n${body}${trailers}\n`;
}

/**
 * Repo-relative, forward-slash paths for `files`, dropping any outside the
 * project. Each carries `:(literal)` so a name with glob characters is matched
 * as written.
 */
export function placementPathspec(projectDir: string, rexDir: string, files: TouchedPrdFiles): string[] {
  const out = new Set<string>();
  for (const file of [...files.written, ...files.deletedFiles]) {
    const rel = relative(projectDir, join(rexDir, file)).split(sep).join("/");
    // Across drive letters `relative` answers an absolute path; outside the project is not ours.
    if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith("../")) continue;
    out.add(`:(literal)${rel}`);
  }
  return [...out];
}

async function git(projectDir: string, args: string[], input?: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await exec("git", args, { cwd: projectDir, timeout: 30_000, ...(input !== undefined ? { input } : {}) });
  return { ok: !result.error && result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}

/** First line of git's complaint, for the "not committed" note. */
function reason(stderr: string, fallback: string): string {
  return stderr.split("\n").map((l) => l.trim()).find(Boolean) ?? fallback;
}

/**
 * Stage and commit the files `touched` names, recording `placed`.
 * Resolves to the short sha, or to why nothing was committed; never throws.
 */
export async function commitPlacements(
  projectDir: string,
  rexDir: string,
  touched: TouchedPrdFiles,
  placed: readonly CommittedPlacement[],
): Promise<PlacementCommit> {
  if (placed.length === 0) return { skipped: "nothing was placed" };
  const pathspec = placementPathspec(projectDir, rexDir, touched);
  if (pathspec.length === 0) return { skipped: "the placement wrote no files inside the project" };
  let tmp: string | undefined;
  try {
    const inside = await git(projectDir, ["rev-parse", "--is-inside-work-tree"]);
    if (!inside.ok || inside.stdout.trim() !== "true") return { skipped: "the project is not a git repository" };

    // The pathspec travels on stdin: a large batch would overrun Windows' command-line limit.
    const spec = pathspec.join("\n") + "\n";
    const staged = await git(projectDir, ["add", "-A", "--pathspec-from-file=-"], spec);
    if (!staged.ok) return { skipped: reason(staged.stderr, "git add failed") };

    tmp = mkdtempSync(join(tmpdir(), "ndx-place-commit-"));
    const messageFile = join(tmp, "message.txt");
    writeFileSync(messageFile, placementMessage(placed), "utf-8");
    // The pathspec limits the commit to these files, leaving anything else the operator staged.
    const committed = await git(projectDir, ["commit", "-F", messageFile, "--pathspec-from-file=-"], spec);
    if (!committed.ok) return { skipped: reason(committed.stderr || committed.stdout, "git commit failed") };

    const head = await git(projectDir, ["rev-parse", "--short", "HEAD"]);
    return head.ok ? { sha: head.stdout.trim() } : { skipped: "committed, but HEAD could not be read" };
  } catch (err) {
    return { skipped: err instanceof Error ? err.message : String(err) };
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}
