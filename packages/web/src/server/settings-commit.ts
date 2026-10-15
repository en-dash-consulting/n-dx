/**
 * Commit a settings change, when fail-forward mode asks for it.
 *
 * Every settings route writes its config file and returns. With fail-forward
 * on, the write is followed by a commit of exactly that file, under a constant
 * message, so a change made in the dashboard does not sit uncommitted until
 * someone notices it in the git panel.
 *
 * One helper for every settings surface is the point, not an accident: the
 * settings page and the pre-run menu edit the same files, and a second commit
 * path for one of them would eventually disagree with the other about scope,
 * message or whether to commit at all.
 *
 * Three properties, matching the rest of fail-forward:
 *
 * - **Scoped.** Only the named config file is staged and committed. Work in
 *   progress elsewhere in the tree is untouched, including anything the
 *   operator had already staged.
 * - **Constant message.** Fixed per settings area, so the history reads
 *   uniformly and there is nothing to review before it lands.
 * - **Never pushes.**
 *
 * Failure is deliberately silent to the caller: a settings save that worked
 * must not report failure because a commit did not. The change is on disk
 * either way, and the git panel will show it.
 *
 * @module web/server/settings-commit
 */

import { relative, sep } from "node:path";
import { exec, isFailForwardEnabled } from "@n-dx/llm-client";

/** Which settings area changed. Drives the constant commit subject. */
export type SettingsArea =
  | "project"
  | "rex"
  | "hench"
  | "llm"
  | "features"
  | "cli";

/** Commit subjects, fixed per area. */
const SUBJECT: Record<SettingsArea, string> = {
  project: "chore(settings): update project settings",
  rex: "chore(settings): update PRD settings",
  hench: "chore(settings): update run settings",
  llm: "chore(settings): update model settings",
  features: "chore(settings): update feature toggles",
  cli: "chore(settings): update CLI timeouts",
};

async function git(
  projectDir: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  const result = await exec("git", args, { cwd: projectDir, timeout: 10_000 });
  return { ok: !result.error && result.exitCode === 0, stdout: result.stdout };
}

/**
 * Stage and commit `configPath` if fail-forward is on and the file is dirty.
 *
 * @param projectDir Repository root.
 * @param configPath Absolute path to the config file that was just written.
 * @param area Which settings area it belongs to.
 * @returns true when a commit was made.
 */
export async function commitSettingsChange(
  projectDir: string,
  configPath: string,
  area: SettingsArea,
): Promise<boolean> {
  try {
    if (!isFailForwardEnabled(projectDir)) return false;

    // git reports and accepts repo-relative paths with forward slashes on
    // every platform.
    const rel = relative(projectDir, configPath).split(sep).join("/");
    // A path outside the project is not ours to commit — and `relative` is the
    // only thing standing between a caller's path and a commit elsewhere.
    if (!rel || rel.startsWith("..")) return false;

    // Nothing to do when the write changed nothing, which is the common case
    // for a save that re-submits the same values.
    const status = await git(projectDir, ["status", "--porcelain", "--", rel]);
    if (!status.ok || status.stdout.trim() === "") return false;

    const staged = await git(projectDir, ["add", "--", `:(literal)${rel}`]);
    if (!staged.ok) return false;

    // The pathspec keeps anything the operator had already staged out of this
    // commit, and makes this a partial commit, which git refuses mid-merge —
    // the right outcome rather than quietly extending a merge.
    const committed = await git(projectDir, [
      "commit",
      "-m",
      SUBJECT[area],
      "-m",
      "N-DX: fail-forward (settings)\nCo-Authored-By: En Dash's n-dx <n-dx@endash.us>",
      "--",
      rel,
    ]);
    return committed.ok;
  } catch {
    // The settings write already succeeded; a commit failure is not the
    // caller's problem and must not turn a good save into an error response.
    return false;
  }
}

/** The subject a given area commits under. Exported for tests. */
export function settingsSubject(area: SettingsArea): string {
  return SUBJECT[area];
}
