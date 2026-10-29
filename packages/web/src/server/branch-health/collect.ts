/**
 * Branch status for one worktree, from fixed rules and no model.
 *
 * Local facts come from git alone and need no network: branch and head, the
 * base, ahead/behind, predicted conflicts and stack containment. GitHub facts
 * (the PR, its checks, failed-check logs) come from `gh` and are read only
 * when the caller says GitHub reads are allowed; without them no gh command
 * runs and `github` is null with a reason. A GitHub read remembers each PR
 * base it finds in a {@link PrBaseCache}; a local-only read uses those for the
 * base and the stack, and says so when it has none.
 *
 * Each predicted conflict is classified with a deterministic fix
 * (`conflicts.ts`) from its merge-tree stages and conflicted result, the
 * project's `web.generatedFiles`, whether the rex-state driver is registered,
 * and the paths other local worktrees' branches changed.
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
import { classifyConflicts, type ConflictSides, type WorktreeChanges } from "./conflicts.js";
import type {
  BaseSource,
  BranchHealth,
  BranchHealthExec,
  FailingCheck,
  GeneratedFileRule,
  GithubFacts,
  PredictedConflict,
  StackLayer,
  WorktreeRef,
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
  /**
   * PR bases found by earlier GitHub reads. A GitHub read fills it; a
   * local-only read uses it for the base and the stack before upstreams.
   */
  prBases?: PrBaseCache;
  /** `web.generatedFiles`: conflicts in these paths are regenerated. None when undeclared. */
  generatedFiles?: readonly GeneratedFileRule[];
  /** Injected for tests; defaults to the llm-client `exec`. */
  exec?: BranchHealthExec;
}

export const LOCAL_ONLY_REASON = "Only local facts were asked for; GitHub facts load when the strip is expanded.";
export const PR_BASE_NOT_READ = "The PR base is not read yet: GitHub facts, and the PR's base, load when the strip is expanded.";

/**
 * The base branch each branch's PR named when GitHub was last read, per
 * worktree. Held in server memory only: a restart forgets it, and the next
 * GitHub read fills it again.
 */
export class PrBaseCache {
  private readonly bases = new Map<string, string>();

  get(projectDir: string, branch: string): string | undefined {
    return this.bases.get(`${projectDir}\0${branch}`);
  }

  set(projectDir: string, branch: string, base: string): void {
    this.bases.set(`${projectDir}\0${branch}`, base);
  }
}

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

/** One conflicted file from merge-tree: its stages and each stage's blob. */
export interface MergeTreeFile {
  path: string;
  stages: number[];
  /** Blob id per stage present. */
  blobs: Partial<Record<1 | 2 | 3, string>>;
}

/** Parse `git merge-tree --write-tree -z --no-messages` output: the result tree and the conflicted files. */
export function parseMergeTree(stdout: string): { tree: string; files: MergeTreeFile[] } {
  // <tree>\0 then one "<mode> <oid> <stage>\t<path>\0" per conflicted stage.
  const [tree = "", ...entries] = stdout.split("\0");
  const byPath = new Map<string, MergeTreeFile>();
  for (const entry of entries) {
    if (entry === "") break;
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const [, oid, stageText] = entry.slice(0, tab).split(" ");
    const stage = Number(stageText);
    const path = entry.slice(tab + 1);
    if (stage !== 1 && stage !== 2 && stage !== 3) continue;
    const file = byPath.get(path) ?? { path, stages: [], blobs: {} };
    if (!file.stages.includes(stage)) file.stages.push(stage);
    file.blobs[stage] = oid;
    byPath.set(path, file);
  }
  for (const file of byPath.values()) file.stages.sort((a, b) => a - b);
  return { tree: tree.trim(), files: [...byPath.values()] };
}

/** A blob as text; null when it cannot be read or is binary. */
async function readBlob(git: Runner, spec: string): Promise<string | null> {
  const out = await git.git(["cat-file", "blob", spec]);
  return out.ok && !out.stdout.includes("\0") ? out.stdout : null;
}

async function readSides(git: Runner, tree: string, file: MergeTreeFile): Promise<ConflictSides> {
  const blob = (stage: 1 | 2 | 3) => (file.blobs[stage] ? readBlob(git, file.blobs[stage]) : Promise.resolve(null));
  const [ancestor, base, branch, result] = await Promise.all([blob(1), blob(2), blob(3), readBlob(git, `${tree}:${file.path}`)]);
  return { path: file.path, stages: file.stages, ancestor, base, branch, result };
}

/** Every other local worktree on a branch, with the paths that branch changed against `base`. */
async function readOtherWorktrees(git: Runner, base: string): Promise<WorktreeChanges[]> {
  const [list, top] = await Promise.all([git.git(["worktree", "list", "--porcelain", "-z"]), git.git(["rev-parse", "--show-toplevel"])]);
  if (!list.ok) return [];
  const self = top.ok ? top.stdout.trim() : null;
  const worktrees: WorktreeRef[] = [];
  let path: string | null = null;
  for (const field of list.stdout.split("\0")) {
    if (field.startsWith("worktree ")) path = field.slice("worktree ".length);
    else if (field.startsWith("branch refs/heads/") && path && path !== self) {
      worktrees.push({ path, branch: field.slice("branch refs/heads/".length) });
    }
  }
  return Promise.all(worktrees.map(async (w) => {
    const out = await git.git(["diff", "--name-only", "-z", `${base}...refs/heads/${w.branch}`]);
    return { ...w, changed: out.ok ? out.stdout.split("\0").filter(Boolean) : [] };
  }));
}

async function predictConflicts(
  git: Runner,
  base: string,
  generatedFiles: readonly GeneratedFileRule[],
): Promise<{ conflicts: PredictedConflict[]; unavailable: string | null }> {
  // diff3 style puts the ancestor's lines in each hunk, which tells an
  // add-only hunk from one that changes a line.
  const out = await git.git(
    ["-c", "merge.conflictStyle=diff3", "merge-tree", "--write-tree", "-z", "--no-messages", base, "HEAD"],
    MERGE_TREE_TIMEOUT_MS,
  );
  // 0 = clean, 1 = conflicts; anything else is git refusing (older than 2.38, unrelated histories).
  if (out.exitCode === 0) return { conflicts: [], unavailable: null };
  if (out.exitCode === 1 && out.stdout) {
    const { tree, files } = parseMergeTree(out.stdout);
    const [sides, driver, worktrees] = await Promise.all([
      Promise.all(files.map((file) => readSides(git, tree, file))),
      git.git(["config", "--get", "merge.rex-state.driver"]),
      readOtherWorktrees(git, base),
    ]);
    const conflicts = classifyConflicts(sides, { generatedFiles, rexStateDriver: driver.ok && driver.stdout.trim() !== "", worktrees });
    return { conflicts, unavailable: null };
  }
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
 * A layer's own base is its PR base when GitHub reads are on, else the PR
 * base an earlier read cached, else its upstream when that names another
 * branch. The chain stops at origin's default branch (the trunk is not a
 * layer), at a branch with no base, at a cycle, or after
 * {@link MAX_STACK_DEPTH} layers.
 */
async function readStack(
  git: Runner,
  base: { ref: string; branch: string },
  upstreams: Map<string, Upstream>,
  defaultBranch: string | null,
  prBases: PrBaseLookup,
): Promise<StackLayer[]> {
  const stack: StackLayer[] = [];
  const seen = new Set<string>();
  let layer: { ref: string; branch: string } | null = base;
  while (layer && stack.length < MAX_STACK_DEPTH && !seen.has(layer.branch) && layer.branch !== defaultBranch) {
    seen.add(layer.branch);
    const contained = await git.git(["merge-base", "--is-ancestor", layer.ref, "HEAD"]);
    stack.push({ branch: layer.branch, contained: contained.ok });
    layer = await nextLayer(git, layer.branch, upstreams, prBases);
  }
  return stack;
}

/** How a branch's PR base is found: asked of gh, and remembered in or read from the cache. */
interface PrBaseLookup {
  gh: boolean;
  projectDir: string;
  cache: PrBaseCache | undefined;
}

async function nextLayer(
  git: Runner,
  branch: string,
  upstreams: Map<string, Upstream>,
  prBases: PrBaseLookup,
): Promise<{ ref: string; branch: string } | null> {
  let baseRefName: string | undefined;
  if (prBases.gh) {
    const found = await viewPr(git, branch, "baseRefName");
    const named = "pr" in found ? found.pr.baseRefName : null;
    if (typeof named === "string" && named) {
      baseRefName = named;
      prBases.cache?.set(prBases.projectDir, branch, named);
    }
  } else {
    baseRefName = prBases.cache?.get(prBases.projectDir, branch);
  }
  if (baseRefName) {
    const ref = await resolveBranchRef(git, baseRefName);
    if (ref) return { ref, branch: baseRefName };
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
  const prBase = pr && typeof pr.baseRefName === "string" && pr.baseRefName ? pr.baseRefName : null;
  if (prBase && branch) options.prBases?.set(projectDir, branch, prBase);
  // A local-only read reuses the PR base the last GitHub read found.
  const cachedBase = !ghAllowed && branch ? options.prBases?.get(projectDir, branch) ?? null : null;
  const prBaseRef = prBase ? await resolveBranchRef(git, prBase) : null;
  const cachedBaseRef = cachedBase ? await resolveBranchRef(git, cachedBase) : null;
  const upstream = branch ? upstreams.get(branch) : undefined;
  if (prBase && prBaseRef) {
    base = { ref: prBaseRef, branch: prBase };
    baseSource = "pr";
  } else if (cachedBase && cachedBaseRef) {
    base = { ref: cachedBaseRef, branch: cachedBase };
    baseSource = "pr-cached";
  } else if (upstream && upstream.branch !== branch) {
    base = upstream;
    baseSource = "upstream";
  } else if (defaultBranch && defaultBranch.branch !== branch) {
    base = defaultBranch;
    baseSource = "default";
  }

  const counts = base ? await aheadBehind(git, base.ref) : { ahead: null, behind: null };
  const predicted = base ? await predictConflicts(git, base.ref, options.generatedFiles ?? []) : { conflicts: [], unavailable: "There is no base to merge with." };
  const prBases: PrBaseLookup = { gh: ghAllowed, projectDir, cache: options.prBases };
  const stack = base ? await readStack(git, base, upstreams, defaultBranch?.branch ?? null, prBases) : [];
  const github = pr ? await readGithubFacts(git, pr, base?.ref ?? null, stack) : null;
  const githubDeferred = options.githubReads && options.localOnly === true;

  return {
    branch,
    head,
    base: base?.ref ?? null,
    baseSource,
    baseNote: githubDeferred && (baseSource === "upstream" || baseSource === "default") ? PR_BASE_NOT_READ : null,
    ahead: counts.ahead,
    behind: counts.behind,
    conflicts: predicted.conflicts,
    conflictsUnavailable: predicted.unavailable,
    stack,
    github,
    githubReason,
    githubDeferred,
  };
}
