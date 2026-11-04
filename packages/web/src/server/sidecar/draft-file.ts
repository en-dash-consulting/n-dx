/**
 * The hub session's `save_draft`: a side-session prompt, a restack plan or a
 * release checklist, saved as a file the operator reads first.
 *
 * Nothing is written before Approve. The card shows the path and lets the
 * operator change it; a relative path lands under the hub's drafts directory.
 * An existing file is never overwritten, and a path inside a `.git`
 * directory is refused: a segment counts as `.git` compared case-insensitively
 * after trailing dots and spaces are stripped (`.GIT`, `.git.` and `.git ` name
 * the same directory on NTFS and default APFS), and the nearest existing
 * ancestor's real path is checked the same way, so a symlink or an 8.3 short
 * name into `.git` is refused too.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.3, §7.
 */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { errorMessage } from "../response-utils.js";
import type { CarryOutResult } from "./carry-out.js";

/** What a draft file is. */
export const DRAFT_FILE_KINDS = ["prompt", "restack-plan", "release-checklist"] as const;
export type DraftFileKind = (typeof DRAFT_FILE_KINDS)[number];

/** A draft's content may be this long: it is a hand-off document, not a log. */
export const DRAFT_FILE_MAX_CHARS = 100_000;

/** The absolute path `path` names (relative ones under `draftsDir`), or why it is refused. */
export function resolveDraftPath(path: unknown, draftsDir: string): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof path !== "string" || path.trim() === "") return { ok: false, error: "a draft's path must be a non-empty string" };
  if (path.includes("\0")) return { ok: false, error: "a draft's path cannot hold a NUL character" };
  const full = resolve(draftsDir, path.trim());
  if (hasGitSegment(full)) return { ok: false, error: GIT_REFUSAL };
  const real = realAncestor(full);
  if (!real.ok) return real;
  if (hasGitSegment(real.path)) return { ok: false, error: `${GIT_REFUSAL} (${full} resolves to ${real.path})` };
  if (!isAbsolute(path.trim()) && full !== draftsDir && !full.startsWith(draftsDir + sep)) {
    return { ok: false, error: `a relative path stays under ${draftsDir}; give an absolute path to save elsewhere` };
  }
  return { ok: true, path: full };
}

const GIT_REFUSAL = "a draft is never saved inside a .git directory";

/** Whether any segment of `path` names `.git` as a case-insensitive filesystem would read it. */
function hasGitSegment(path: string): boolean {
  return path.split(/[\\/]/).some((segment) => segment.replace(/[. ]+$/, "").toLowerCase() === ".git");
}

/** The real path of `path`'s nearest existing ancestor (or `path` itself), symlinks and short names resolved. */
function realAncestor(path: string): { ok: true; path: string } | { ok: false; error: string } {
  for (let current = path; ; current = dirname(current)) {
    try {
      return { ok: true, path: realpathSync.native(current) };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const missing = code === "ENOENT" || code === "ENOTDIR";
      if (!missing || dirname(current) === current) return { ok: false, error: `cannot check where ${path} leads: ${errorMessage(err)}` };
    }
  }
}

/** Write `content` to the approved `path`; refuses a file that exists. Never throws. */
export function saveDraftFile(path: string, content: string): CarryOutResult {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { encoding: "utf-8", flag: "wx" });
    return { ok: true, text: `Saved the draft to ${path}. Nothing else ran.` };
  } catch (err) {
    const exists = (err as NodeJS.ErrnoException).code === "EEXIST";
    return { ok: false, text: exists ? `Nothing was saved: ${path} already exists.` : `Nothing was saved: ${errorMessage(err)}.` };
  }
}
