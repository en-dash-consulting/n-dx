/**
 * Branch status for one worktree, from fixed rules and no model.
 *
 * Local facts come from git alone and need no network: branch and head, the
 * base, ahead/behind, predicted conflicts and stack containment. GitHub facts
 * (the PR, its checks, failed-check logs) come from `gh` and are read only
 * when the caller says GitHub reads are allowed; without them no gh command
 * runs and `github` is null with a reason.
 *
 * Nothing here changes the worktree, the index or HEAD. `git merge-tree
 * --write-tree` computes the merge in the object store only.
 *
 * @module web/server/branch-health/collect
 */

import { exec as llmExec } from "@n-dx/llm-client";
import { errorMessage } from "../response-utils.js";
import {
  capLogTail,
  classifyFailingCheck,
  cleanLog,
  isFailing,
  isPending,
  parseRollup,
} from "./checks.js";
import type {
  BaseSource,
  BranchHealth,
  BranchHealthExec,
  FailingCheck,
  GithubFacts,
  PredictedConflict,
  StackLayer,
} from "./types.js";

export interface CollectOptions {
  /** Whether `gh` may be asked (the project's `web.sidecarGithubReads`). */
  githubReads: boolean;
  /**
   * Read local facts only, even when GitHub reads are allowed: no gh command
   * runs, so the base and stack come from upstreams. The Workspaces board asks
   * this way on mount and for GitHub facts only when a strip is expanded.
   */
  localOnly?: boolean;
  /** Injected for tests; defaults to the llm-client `exec`. */
  exec?: BranchHealthExec;
}

export const LOCAL_ONLY_REASON = "Only local facts were asked for; GitHub facts load when the strip is expanded.";

const GIT_TIMEOUT_MS = 10_000;
const MERGE_TREE_TIMEOUT_MS = 30_000;
const GH_TIMEOUT_MS = 20_000;
/** A failed job's whole log is read before it is cut to a tail. */
const LOG_MAX_BUFFER = 32 * 1024 * 1024;
/** Stack layers below this branch that are followed before giving up. */
const MAX_STACK_DEPTH = 10;

const PR_FIELDS = "number,url,baseRefName,isCrossRepository,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup";

interface Run {
  ok: boolean;
  /** False when the command never started (e.g. gh not installed). */
  launched: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

class Runner {
  constructor(private readonly cwd: string, private readonly run: BranchHealthExec) {}

  async git(args: string[], timeout = GIT_TIMEOUT_MS): Promise<Run> {
    return this.exec("git", ["-c", "core.quotepath=false", ...args], timeout);
  }

  async gh(args: string[], maxBuffer?: number): Promise<Run> {
    return this.exec("gh", args, GH_TIMEOUT_MS, maxBuffer);
  }

  private async exec(cmd: string, args: string[], timeout: number, maxBuffer?: number): Promise<Run> {
    const result = await this.run(cmd, args, {
      cwd: this.cwd,
      timeout,
      ...(maxBuffer ? { maxBuffer } : {}),
      // gh must never stop to ask; a missing login is an answer, not a prompt.
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    return {
      ok: !result.error && result.exitCode === 0,
      launched: result.launched,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

/** One local branch's upstream, from `for-each-ref`. */
interface Upstream {
  /** The ref to compare against, e.g. `origin/feat/x`, or `main` for a local upstream. */
  ref: string;
  /** The branch name on the upstream's side, e.g. `feat/x`. */
  branch: string;
}

/** Every local branch's upstream. Branches without one are absent. */
async function readUpstreams(git: Runner): Promise<Map<string, Upstream>> {
  const out = await git.git([
    "for-each-ref",
    "--format=%(refname:short)%00%(upstream:short)%00%(upstream:remoteref)",
    "refs/heads",
  ]);
  const map = new Map<string, Upstream>();
  if (!out.ok) return map;
  for (const line of out.stdout.split("\n")) {
    const [name, ref, remoteRef] = line.split("\0");
    if (!name || !ref) continue;
    map.set(name, { ref, branch: (remoteRef ?? "").replace(/^refs\/heads\//, "") || ref });
  }
  return map;
}

/** origin's default branch as a ref and a name (`origin/main`, `main`), or null. */
async function readDefaultBranch(git: Runner): Promise<{ ref: string; branch: string } | null> {
  const out = await git.git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const ref = out.ok ? out.stdout.trim() : "";
  if (!ref) return null;
  return { ref, branch: ref.replace(/^origin\//, "") };
}

/** A branch name as a ref this repository has: origin's copy first, else the local branch. */
async function resolveBranchRef(git: Runner, branch: string): Promise<string | null> {
  for (const ref of [`refs/remotes/origin/${branch}`, `refs/heads/${branch}`]) {
    const out = await git.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (out.ok) return ref.replace(/^refs\/(?:remotes|heads)\//, "");
  }
  return null;
}

/** Parse `git merge-tree --write-tree -z --no-messages` output into conflicted files. */
export function parseMergeTree(stdout: string): PredictedConflict[] {
  // <tree>\0 then one "<mode> <oid> <stage>\t<path>\0" per conflicted stage.
  const entries = stdout.split("\0").slice(1);
  const byPath = new Map<string, Set<number>>();
  for (const entry of entries) {
    if (entry === "") break;
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const stage = Number(entry.slice(0, tab).split(" ")[2]);
    const path = entry.slice(tab + 1);
    if (!Number.isInteger(stage)) continue;
    const stages = byPath.get(path) ?? new Set<number>();
    stages.add(stage);
    byPath.set(path, stages);
  }
  return [...byPath].map(([path, stages]) => ({ path, stages: [...stages].sort((a, b) => a - b) }));
}

async function predictConflicts(git: Runner, base: string): Promise<{ conflicts: PredictedConflict[]; unavailable: string | null }> {
  const out = await git.git(["merge-tree", "--write-tree", "-z", "--no-messages", base, "HEAD"], MERGE_TREE_TIMEOUT_MS);
  // 0 = clean, 1 = conflicts; anything else is git refusing (older than 2.38, unrelated histories).
  if (out.exitCode === 0) return { conflicts: [], unavailable: null };
  if (out.exitCode === 1 && out.stdout) return { conflicts: parseMergeTree(out.stdout), unavailable: null };
  return {
    conflicts: [],
    unavailable: `git merge-tree could not predict the merge: ${out.stderr.trim() || "no output"}. It needs git 2.38 or newer.`,
  };
}

async function aheadBehind(git: Runner, base: string): Promise<{ ahead: number | null; behind: number | null }> {
  const out = await git.git(["rev-list", "--left-right", "--count", `${base}...HEAD`]);
  const [behind, ahead] = out.ok ? out.stdout.trim().split(/\s+/).map(Number) : [];
  return Number.isInteger(ahead) && Number.isInteger(behind) ? { ahead, behind } : { ahead: null, behind: null };
}

/** gh's answer for one branch's PR, or the reason there is none. */
type PrLookup = { pr: Record<string, unknown> } | { reason: string };

async function viewPr(git: Runner, branch: string | null, fields: string): Promise<PrLookup> {
  const out = await git.gh(["pr", "view", ...(branch ? [branch] : []), "--json", fields]);
  if (!out.launched) return { reason: "gh is not installed, so no GitHub facts were read." };
  if (!out.ok) {
    const said = out.stderr.trim().split("\n")[0] || `gh exited ${out.exitCode ?? "on a timeout"}`;
    return { reason: `gh pr view answered: ${said}` };
  }
  let pr: unknown;
  try {
    pr = JSON.parse(out.stdout);
  } catch (err) {
    return { reason: `gh pr view returned output that is not JSON: ${errorMessage(err)}` };
  }
  if (pr && typeof pr === "object" && !Array.isArray(pr)) return { pr: pr as Record<string, unknown> };
  return { reason: "gh pr view returned JSON that is not an object." };
}

/**
 * The layers below `base` in this branch's base chain, each checked against HEAD.
 *
 * A layer's own base is its PR base when GitHub reads are on, else its
 * upstream when that names another branch. The chain stops at origin's default
 * branch (the trunk is not a layer), at a branch with no base, at a cycle, or
 * after {@link MAX_STACK_DEPTH} layers.
 */
async function readStack(
  git: Runner,
  base: { ref: string; branch: string },
  upstreams: Map<string, Upstream>,
  defaultBranch: string | null,
  githubReads: boolean,
): Promise<StackLayer[]> {
  const stack: StackLayer[] = [];
  const seen = new Set<string>();
  let layer: { ref: string; branch: string } | null = base;
  while (layer && stack.length < MAX_STACK_DEPTH && !seen.has(layer.branch) && layer.branch !== defaultBranch) {
    seen.add(layer.branch);
    const contained = await git.git(["merge-base", "--is-ancestor", layer.ref, "HEAD"]);
    stack.push({ branch: layer.branch, contained: contained.ok });
    layer = await nextLayer(git, layer.branch, upstreams, githubReads);
  }
  return stack;
}

async function nextLayer(
  git: Runner,
  branch: string,
  upstreams: Map<string, Upstream>,
  githubReads: boolean,
): Promise<{ ref: string; branch: string } | null> {
  if (githubReads) {
    const found = await viewPr(git, branch, "baseRefName");
    const baseRefName = "pr" in found ? found.pr.baseRefName : null;
    if (typeof baseRefName === "string" && baseRefName) {
      const ref = await resolveBranchRef(git, baseRefName);
      if (ref) return { ref, branch: baseRefName };
    }
  }
  const upstream = upstreams.get(branch);
  return upstream && upstream.branch !== branch ? upstream : null;
}

/** Repo-relative paths this branch changed against its base. */
async function changedFiles(git: Runner, base: string): Promise<string[]> {
  const out = await git.git(["diff", "--name-only", "-z", `${base}...HEAD`]);
  return out.ok ? out.stdout.split("\0").filter(Boolean) : [];
}

/** The whole failed log, cleaned; the classifier reads all of it and only the stored tail is capped. */
async function readFailedLog(git: Runner, runId: string, jobId: string | null): Promise<string | null> {
  const out = await git.gh(["run", "view", runId, ...(jobId ? ["--job", jobId] : []), "--log-failed"], LOG_MAX_BUFFER);
  return out.ok && out.stdout.trim() ? cleanLog(out.stdout) : null;
}

async function readGithubFacts(
  git: Runner,
  pr: Record<string, unknown>,
  base: string | null,
  stack: readonly StackLayer[],
): Promise<GithubFacts> {
  const checks = parseRollup(pr.statusCheckRollup);
  const failingChecks = checks.filter(isFailing);
  const isCrossRepository = pr.isCrossRepository === true;
  const mergeStateStatus = typeof pr.mergeStateStatus === "string" ? pr.mergeStateStatus : "UNKNOWN";
  const changed = failingChecks.length > 0 && base ? await changedFiles(git, base) : [];
  const failing: FailingCheck[] = [];
  for (const check of failingChecks) {
    const log = check.runId ? await readFailedLog(git, check.runId, check.jobId) : null;
    const verdict = classifyFailingCheck({
      name: check.name,
      outcome: check.outcome,
      log,
      isCrossRepository,
      changedFiles: changed,
      mergeStateStatus,
      stack,
    });
    failing.push({ name: check.name, conclusion: check.outcome, url: check.url, ...verdict, logTail: log === null ? null : capLogTail(log) });
  }
  return {
    number: typeof pr.number === "number" ? pr.number : 0,
    url: typeof pr.url === "string" ? pr.url : "",
    baseRefName: typeof pr.baseRefName === "string" ? pr.baseRefName : "",
    isCrossRepository,
    mergeable: typeof pr.mergeable === "string" ? pr.mergeable : "UNKNOWN",
    mergeStateStatus,
    reviewDecision: typeof pr.reviewDecision === "string" && pr.reviewDecision ? pr.reviewDecision : null,
    checks: { total: checks.length, failing: failing.length, pending: checks.filter(isPending).length },
    failing,
  };
}

/** Thrown when `projectDir` is not inside a git work tree with a commit. */
export class NotAGitBranchError extends Error {}

export async function collectBranchHealth(projectDir: string, options: CollectOptions): Promise<BranchHealth> {
  const git = new Runner(projectDir, options.exec ?? llmExec);

  const headOut = await git.git(["rev-parse", "HEAD"]);
  if (!headOut.ok) throw new NotAGitBranchError(headOut.stderr.trim() || "not a git repository with a commit");
  const head = headOut.stdout.trim();
  const branchOut = await git.git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = branchOut.ok ? branchOut.stdout.trim() : null;

  const [upstreams, defaultBranch] = await Promise.all([readUpstreams(git), readDefaultBranch(git)]);

  const ghAllowed = options.githubReads && !options.localOnly;
  // GitHub first, because the PR base outranks every local guess.
  let pr: Record<string, unknown> | null = null;
  let githubReason: string | null = null;
  if (!options.githubReads) {
    githubReason = "GitHub reads are off for this project (web.sidecarGithubReads), so no gh command ran.";
  } else if (options.localOnly) {
    githubReason = LOCAL_ONLY_REASON;
  } else if (!branch) {
    githubReason = "HEAD is detached, so there is no branch to find a PR for.";
  } else {
    const found = await viewPr(git, null, PR_FIELDS);
    if ("pr" in found) pr = found.pr;
    else githubReason = found.reason;
  }

  let base: { ref: string; branch: string } | null = null;
  let baseSource: BaseSource | null = null;
  const prBase = pr && typeof pr.baseRefName === "string" ? pr.baseRefName : null;
  const prBaseRef = prBase ? await resolveBranchRef(git, prBase) : null;
  const upstream = branch ? upstreams.get(branch) : undefined;
  if (prBase && prBaseRef) {
    base = { ref: prBaseRef, branch: prBase };
    baseSource = "pr";
  } else if (upstream && upstream.branch !== branch) {
    base = upstream;
    baseSource = "upstream";
  } else if (defaultBranch && defaultBranch.branch !== branch) {
    base = defaultBranch;
    baseSource = "default";
  }

  const counts = base ? await aheadBehind(git, base.ref) : { ahead: null, behind: null };
  const predicted = base ? await predictConflicts(git, base.ref) : { conflicts: [], unavailable: "There is no base to merge with." };
  const stack = base ? await readStack(git, base, upstreams, defaultBranch?.branch ?? null, ghAllowed) : [];
  const github = pr ? await readGithubFacts(git, pr, base?.ref ?? null, stack) : null;

  return {
    branch,
    head,
    base: base?.ref ?? null,
    baseSource,
    ahead: counts.ahead,
    behind: counts.behind,
    conflicts: predicted.conflicts,
    conflictsUnavailable: predicted.unavailable,
    stack,
    github,
    githubReason,
    githubDeferred: options.githubReads && options.localOnly === true,
  };
}
