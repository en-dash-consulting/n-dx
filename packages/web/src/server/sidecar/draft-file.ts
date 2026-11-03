/**
 * The hub session's `save_draft`: a side-session prompt, a restack plan or a
 * release checklist, saved as a file the operator reads first.
 *
 * Nothing is written before Approve. The card shows the path and lets the
 * operator change it; a relative path lands under the hub's drafts directory.
 * An existing file is never overwritten, and a path inside a `.git`
 * directory is refused.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.3, §7.
 */

import { mkdirSync, writeFileSync } from "node:fs";
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
  if (full.split(sep).includes(".git")) return { ok: false, error: "a draft is never saved inside a .git directory" };
  if (!isAbsolute(path.trim()) && full !== draftsDir && !full.startsWith(draftsDir + sep)) {
    return { ok: false, error: `a relative path stays under ${draftsDir}; give an absolute path to save elsewhere` };
  }
  return { ok: true, path: full };
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
