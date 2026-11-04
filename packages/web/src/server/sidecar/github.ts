/**
 * The GitHub reads and posts a Sidecar broker call carries out.
 *
 * `github_read` has two kinds. `pr` reads the attached worktree's PR, its
 * checks and each failing check's log tail through `collectBranchHealth`.
 * `check` reads the newest run of one check on a base branch, which is the
 * only way a failing check is called "failing on main": the class comes from
 * GitHub's answer for the base, never from a guess. `draft_github_post`
 * posts a comment or a review comment on a PR, under the operator's own gh
 * login, and only once its card is approved.
 *
 * gh runs through the llm-client `exec` (injected for tests), never a shell,
 * and never stops to prompt.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §5 (Q6), §7.
 */

import type { BranchHealthExec } from "../branch-health/index.js";
import type { CarryOutResult, GithubDraft } from "./carry-out.js";

const GH_TIMEOUT_MS = 20_000;
/** gh must never stop to ask; a missing login is an answer, not a prompt. */
const GH_ENV = { GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" };

/** What one check's newest run on a branch concluded. */
export interface BaseCheckRun {
  name: string;
  base: string;
  /** `success`, `failure`, … as GitHub reports it; null while the run has not concluded. */
  conclusion: string | null;
  status: string;
  sha: string;
  url: string | null;
}

/** The first line gh said on a failure, or how it ended. */
function ghSaid(result: { stderr: string; exitCode: number | null; launched: boolean }): string {
  if (!result.launched) return "gh is not installed";
  return result.stderr.trim().split("\n")[0] || `gh exited ${result.exitCode ?? "on a timeout"}`;
}

/**
 * The newest run of check `name` on branch `base`, from the check-runs API
 * for the branch's head commit; a string says why there is none.
 */
export async function readCheckOnBase(
  exec: BranchHealthExec,
  cwd: string,
  name: string,
  base: string,
): Promise<BaseCheckRun | string> {
  const path = `repos/{owner}/{repo}/commits/${encodeURIComponent(base)}/check-runs?check_name=${encodeURIComponent(name)}&per_page=1`;
  const result = await exec("gh", ["api", path], { cwd, timeout: GH_TIMEOUT_MS, env: { ...process.env, ...GH_ENV } });
  if (!result.launched || result.error || result.exitCode !== 0) return `gh api answered: ${ghSaid(result)}`;
  let body: unknown;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    return "gh api returned output that is not JSON";
  }
  const runs = (body as { check_runs?: unknown })?.check_runs;
  const run = Array.isArray(runs) ? (runs[0] as Record<string, unknown> | undefined) : undefined;
  if (!run) return `no run of "${name}" is recorded on ${base}'s head commit`;
  const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  return {
    name,
    base,
    conclusion: text(run.conclusion),
    status: text(run.status) ?? "unknown",
    sha: text(run.head_sha) ?? "",
    url: text(run.html_url),
  };
}

const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

/** The class a check failing on the repository's default branch takes. */
export const CLASS_FAILING_ON_MAIN = "failing on main";

/** The class a check failing on any other base takes: a stacked PR's base is its parent layer, not main. */
export function classFailingOnBase(base: string): string {
  return `failing on the base (${base})`;
}

/** The toggle a `pr` read (branch health) sits behind, as GET /api/branch-health. */
export const BRANCH_HEALTH_FEATURE_KEY = "git.branchHealth";

/** What a `pr` read answers while `git.branchHealth` is off; the Diagnose branch lens is unavailable then too. */
export const BRANCH_HEALTH_OFF_READ = "Nothing was read: the git.branchHealth feature is off.";

/** origin's default branch name (`main`), or null when this checkout does not know it. */
export async function readDefaultBranchName(exec: BranchHealthExec, cwd: string): Promise<string | null> {
  const result = await exec("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd, timeout: GH_TIMEOUT_MS });
  const ref = result.launched && !result.error && result.exitCode === 0 ? result.stdout.trim() : "";
  return ref ? ref.replace(/^origin\//, "") : null;
}

/**
 * The tool result for a `check` read: whether the check fails on the base too,
 * decided by GitHub's answer. The class is "failing on main" only when `base`
 * is `defaultBranch`; an unknown default branch never earns it.
 */
export function baseCheckResult(read: BaseCheckRun | string, name: string, base: string, defaultBranch: string | null): CarryOutResult {
  if (typeof read === "string") {
    return { ok: false, text: `Could not read "${name}" on ${base}: ${read}. Whether it is failing on ${base} is not verified; do not call it that.` };
  }
  const at = `${base}${read.sha ? ` (${read.sha.slice(0, 9)})` : ""}${read.url ? `, ${read.url}` : ""}`;
  if (read.conclusion === null) {
    return { ok: true, text: `"${name}" on ${at} is ${read.status}, not concluded: whether it is failing on ${base} is not verified yet.` };
  }
  const failing = FAILED_CONCLUSIONS.has(read.conclusion.toLowerCase());
  return {
    ok: true,
    text: failing
      ? `"${name}" on ${at} concluded ${read.conclusion}: it is failing on ${base} too. Class: ${base === defaultBranch ? CLASS_FAILING_ON_MAIN : classFailingOnBase(base)}.`
      : `"${name}" on ${at} concluded ${read.conclusion}: it is not failing on ${base}. Keep the class the packet gives.`,
  };
}

/**
 * Post a draft under the operator's gh login: `comment` with `gh pr
 * comment`, `review` as a review comment with `gh pr review --comment`. The
 * body goes in on stdin, so no length or quoting limit applies.
 */
export async function postGithubDraft(
  exec: BranchHealthExec,
  cwd: string,
  draft: GithubDraft,
): Promise<CarryOutResult> {
  const args = draft.kind === "comment"
    ? ["pr", "comment", draft.target, "--body-file", "-"]
    : ["pr", "review", draft.target, "--comment", "--body-file", "-"];
  const result = await exec("gh", args, { cwd, timeout: GH_TIMEOUT_MS, input: draft.body, env: { ...process.env, ...GH_ENV } });
  if (!result.launched || result.error || result.exitCode !== 0) {
    return { ok: false, text: `Nothing was posted: gh answered: ${ghSaid(result)}.` };
  }
  const url = result.stdout.trim().split("\n").find((line) => line.startsWith("https://"));
  return { ok: true, text: `Posted the ${draft.kind} on ${draft.target} under the operator's gh login${url ? `: ${url}` : ""}.` };
}
