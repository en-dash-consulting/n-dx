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

import { readFileSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { exec, isFailForwardEnabled } from "@n-dx/llm-client";

/** Which settings area changed. Drives the constant commit subject. */
export type SettingsArea =
  | "project"
  | "rex"
  | "hench"
  | "llm"
  | "features"
  | "cli"
  | "sidecar";

/** Commit subjects, fixed per area. */
const SUBJECT: Record<SettingsArea, string> = {
  project: "chore(settings): update project settings",
  rex: "chore(settings): update PRD settings",
  hench: "chore(settings): update run settings",
  llm: "chore(settings): update model settings",
  features: "chore(settings): update feature toggles",
  cli: "chore(settings): update CLI timeouts",
  sidecar: "chore(settings): update Sidecar settings",
};

/**
 * Key names whose value must never be committed.
 *
 * `.n-dx.json` is meant to be committed — which is why `packages/core/config.js`
 * routes `*.api_key` to `.n-dx.local.json` instead, and why `ndx ci` ships a
 * step that fails a tracked config holding one. A legacy install or a hand
 * edit can still leave a key there, and an automatic commit must not be the
 * thing that carries it to a remote.
 */
const SECRET_KEY_PATTERN = /(api[_-]?key|secret|password|token|credential)/i;

/** Whether any key anywhere in the parsed config looks like a credential. */
function carriesSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(carriesSecret);
  if (value === null || typeof value !== "object") return false;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    // A key with an empty or absent value is a placeholder, not a secret.
    if (SECRET_KEY_PATTERN.test(key) && typeof inner === "string" && inner.trim() !== "") {
      return true;
    }
    if (carriesSecret(inner)) return true;
  }
  return false;
}

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
    // A path outside the project is not ours to commit. `startsWith("..")`
    // alone is not enough: across Windows drive letters and for a UNC path
    // `relative` returns an absolute path, which passes that test — and it
    // also wrongly rejects a legitimate in-project file named `..config.json`.
    if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(".." + "/")) return false;

    // Never auto-commit a config that carries a credential. Refusing leaves
    // the change on disk and visible in the git panel, which is the safe
    // outcome: the operator can move the key to .n-dx.local.json and commit
    // deliberately.
    try {
      if (carriesSecret(JSON.parse(readFileSync(configPath, "utf-8")))) return false;
    } catch {
      // Unreadable or unparseable: do not commit something we cannot inspect.
      return false;
    }

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
