/**
 * Branch work collector — identifies completed rex PRD items on the current branch.
 *
 * ## Architecture
 *
 * Sourcevision and rex are peer domain packages that **never import each other
 * at runtime**. Everything this module knows about the PRD therefore comes from
 * spawning the rex CLI, which is the only sanctioned route across that
 * boundary:
 *
 * - `rex tree --format=json` — the PRD as it stands in this checkout, with the
 *   item content a report needs (description, acceptance criteria, tags,
 *   priority).
 * - `rex tree-diff --json` — which items this branch completed that the base
 *   branch had not. `--from=<base>` is added only when a base branch was
 *   given explicitly; otherwise tree-diff picks its own default
 *   (`origin/HEAD`, else local `main`/`master`), which knows about the
 *   remote's default branch in a way a local branch of the same name does not.
 *
 * ## Why rex owns the diff
 *
 * This module used to compute the completion diff itself, over two documents it
 * read and parsed here. That is the same question `rex tree-diff` answers for
 * the CLI and for the dashboard's Workspaces board, and three implementations
 * of "what did this branch finish" are free to disagree — the kind of defect
 * nobody thinks to look for, because each one looks right on its own. rex is
 * the domain owner, so rex computes it and this module projects the answer.
 *
 * It also fixes a live defect. The previous implementation read `.rex/prd.md`,
 * which does not exist on a project migrated to the folder tree, so the
 * Completed Work section of the pull-request markdown silently found nothing.
 * **No code path here reads `.rex/prd.md` or `.rex/prd.json`.** Legacy projects
 * are still handled, but by rex: `rex tree` migrates a legacy `prd.json` to the
 * folder tree before reading it, which is why it is spawned first.
 *
 * ## Algorithm
 *
 * 1. Read the current PRD via `rex tree --format=json`.
 * 2. Detect the branch and its base (main or master unless told otherwise).
 * 3. Ask `rex tree-diff` which items this branch completed.
 * 4. Build enriched work items with parent chain and epic summaries from (1).
 *
 * ## Degradation
 *
 * A non-git directory, or a base branch git cannot resolve, leaves nothing to
 * diff against. Rather than failing, every completed item in the current PRD is
 * treated as branch work — a summary of the project's completed work is the
 * most useful thing available when there is no branch to attribute it to. When
 * that fallback is taken because the diff *failed* (as opposed to there being
 * no git at all), the reason is recorded in `errors` so it surfaces as a
 * warning rather than passing for a real answer.
 *
 * A diff that *succeeded* but reported either side as having no PRD tree at
 * all (a legacy project never migrated to the folder tree, or a base ref that
 * predates the PRD) is a third case, handled differently from both of the
 * above: it reports no branch work, with a warning, rather than the empty
 * section that a legacy project's absent working tree would otherwise
 * silently produce, or the whole project that an absent baseline would
 * otherwise silently credit to the branch.
 *
 * @module sourcevision/analyzers/branch-work-collector
 */

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { execFileSyncCli } from "../util/exec-cli.js";
import { getCurrentBranch } from "@n-dx/llm-client";

// ---------------------------------------------------------------------------
// Lightweight PRD types (mirrors rex schema — no runtime import from rex)
// ---------------------------------------------------------------------------

/** Minimal PRDItem shape needed for collection. */
interface PRDItemShape {
  id: string;
  title: string;
  status: string;
  level: string;
  description?: string;
  acceptanceCriteria?: string[];
  completedAt?: string;
  priority?: string;
  tags?: string[];
  children?: PRDItemShape[];
}

/** Minimal PRDDocument shape. */
interface PRDDocumentShape {
  schema: string;
  title: string;
  items: PRDItemShape[];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Reference to an ancestor in the PRD hierarchy. */
export interface ParentRef {
  id: string;
  title: string;
  level: string;
}

/** A completed work item attributed to the current branch. */
export interface BranchWorkItem {
  id: string;
  title: string;
  level: string;
  completedAt?: string;
  priority?: string;
  tags?: string[];
  description?: string;
  acceptanceCriteria?: string[];
  parentChain: ParentRef[];
}

/** Per-epic summary of branch work. */
export interface EpicSummary {
  id: string;
  title: string;
  completedCount: number;
}

/** Full result from the collector. */
export interface BranchWorkResult {
  /** Current branch name (or "unknown" when git is unavailable). */
  branch: string;
  /** Base branch used for diffing (e.g. "main", "master"). */
  baseBranch: string;
  /** ISO timestamp when the collection was performed. */
  collectedAt: string;
  /** Completed work items unique to this branch. */
  items: BranchWorkItem[];
  /** Per-epic aggregation of branch-specific completions. */
  epicSummaries?: EpicSummary[];
  /** Non-fatal errors encountered during collection. */
  errors?: string[];
}

/**
 * What asking rex for the branch's completed ids came back with.
 *
 * `baseBranch` echoes what tree-diff actually compared against
 * (`sources.from.label`) — which is not necessarily the `baseBranch` the
 * caller passed in, since an omitted one lets tree-diff pick its own default
 * (`origin/HEAD`, else local `main`/`master`).
 *
 * `reliable` is false when either side of the diff had no PRD tree at all —
 * an absent baseline makes every current completion look new, and an absent
 * working tree makes every one look gone. `ids` is empty whenever `reliable`
 * is false: the caller must not fall back to treating it as a real (if
 * incomplete) answer, because a diff computed against/from an absent tree
 * does not mean what its `completed` array would otherwise suggest.
 */
export interface DiffCompletedAnswer {
  baseBranch: string;
  ids: Set<string>;
  reliable: boolean;
}

/**
 * The two questions this module asks rex, as an injectable pair.
 *
 * Both default to spawning the real `rex` CLI. They are injectable so the
 * collector's own branching — base-branch detection, the fallbacks, what lands
 * in `errors` — can be unit-tested without a git repository and a built rex on
 * PATH, which is the difference between a test that runs in milliseconds
 * everywhere and one that is a small integration suite in disguise. The real
 * wiring is covered end-to-end by the `sv pr-markdown` e2e test.
 */
export interface RexBridge {
  /** The PRD as it stands in `dir`, or null when there is none to read. */
  readPRD: (dir: string) => PRDDocumentShape | null;
  /**
   * Diff `dir` against `baseBranch` when given, or let rex pick its own
   * default baseline when omitted. Returns null when the comparison could
   * not be made at all — an unresolvable ref, or no git.
   */
  diffCompleted: (dir: string, baseBranch?: string) => DiffCompletedAnswer | null;
}

/** Options for the collector. */
export interface CollectorOptions {
  /** Project root directory. */
  dir: string;
  /** Base branch to diff against. Auto-detected when omitted. */
  baseBranch?: string;
  /** Overrides for the rex calls. Defaults to spawning the real CLI. */
  rex?: Partial<RexBridge>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Stdout budget for the rex spawns below.
 *
 * `execFileSync` defaults `maxBuffer` to 1 MiB and does not truncate past it —
 * it kills the child and throws `ENOBUFS`, which the callers here would read as
 * "no PRD" and report as an empty Completed Work section. That is the exact
 * defect this module was rewritten to fix, so the default is not survivable: a
 * whole PRD serialised to JSON passes 1 MiB on any real project. n-dx's own
 * tree measured 3.2 MiB, and it is not the largest PRD this will meet.
 *
 * 64 MiB is headroom of roughly twenty times that, while still bounded — an
 * unbounded buffer would turn a runaway child into an out-of-memory crash
 * rather than an error.
 */
const REX_STDOUT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Read the PRD of a checkout by spawning `rex tree --format=json`.
 *
 * This is the folder-tree replacement for the `rex parse-md --stdin` seam that
 * used to serve `.rex/prd.md`: one command, canonical JSON on stdout, rex's own
 * parser on the other side of it. Returns null on any spawn / parse failure —
 * an uninitialised project is the common cause and is not an error here.
 */
export function readPRDViaRex(dir: string): PRDDocumentShape | null {
  try {
    const out = execFileSyncCli("rex", ["tree", "--format=json", dir], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: REX_STDOUT_MAX_BUFFER,
    });
    const parsed = JSON.parse(out as string);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return { schema: "rex/v1", title: "", ...parsed } as PRDDocumentShape;
  } catch {
    return null;
  }
}

/** What `rex tree-diff --json` reports, narrowed to the part used here. */
interface TreeDiffOutput {
  sources?: {
    from?: { label?: string; present?: boolean };
    to?: { present?: boolean };
  };
  completed?: { id: string }[];
}

/**
 * Ask rex which items this branch completed that `baseBranch` had not.
 *
 * `baseBranch` is passed as `--from` only when given — omitting it lets
 * tree-diff apply its own default (`origin/HEAD`, else local `main`/`master`),
 * which is more likely to be right than a base branch this module detected
 * locally (see the module docs on why rex, not this file, owns the diff).
 *
 * Returns null when the diff could not be computed at all — an unresolvable
 * base ref, or no git. The caller decides what to do about that; this function
 * does not invent an answer, because "nothing was completed" and "I could not
 * tell" are different facts and only one of them is worth reporting as work.
 *
 * When the JSON parses but either side of the diff had no PRD tree at all
 * (`sources.from.present` or `sources.to.present` is `false` — a legacy
 * project never migrated to the folder tree, or a base ref that predates the
 * PRD), the answer comes back with `reliable: false` and an empty `ids`
 * rather than tree-diff's raw `completed` array: an absent baseline makes
 * every current completion look new, and an absent working tree makes every
 * one look gone, so neither is "what this branch did".
 */
export function diffCompletedViaRex(
  dir: string,
  baseBranch?: string,
): DiffCompletedAnswer | null {
  try {
    const out = execFileSyncCli(
      "rex",
      ["tree-diff", "--json", ...(baseBranch ? [`--from=${baseBranch}`] : []), dir],
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: REX_STDOUT_MAX_BUFFER,
      },
    );
    const parsed = JSON.parse(out as string) as TreeDiffOutput;
    const fromLabel = parsed?.sources?.from?.label;
    if (!parsed || !Array.isArray(parsed.completed) || typeof fromLabel !== "string") return null;

    const reliable = parsed.sources?.from?.present !== false && parsed.sources?.to?.present !== false;
    return {
      baseBranch: fromLabel,
      ids: reliable ? new Set(parsed.completed.map((entry) => entry.id)) : new Set(),
      reliable,
    };
  } catch {
    return null;
  }
}

/**
 * Every completed id in a tree — the fallback set when there is no baseline to
 * diff against.
 */
export function collectCompletedIds(items: PRDItemShape[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: PRDItemShape[]): void {
    for (const item of list) {
      if (item.status === "completed") {
        ids.add(item.id);
      }
      if (item.children) {
        walk(item.children);
      }
    }
  }
  walk(items);
  return ids;
}

/**
 * Build enriched BranchWorkItem records for the given set of IDs.
 * Traverses the full tree to reconstruct parent chains.
 *
 * @param items     - Full PRD item tree
 * @param branchIds - Set of IDs to include in the result
 */
export function buildBranchWorkItems(
  items: PRDItemShape[],
  branchIds: Set<string>,
): BranchWorkItem[] {
  if (branchIds.size === 0) return [];

  const result: BranchWorkItem[] = [];

  function walk(list: PRDItemShape[], parents: ParentRef[]): void {
    for (const item of list) {
      if (branchIds.has(item.id)) {
        result.push({
          id: item.id,
          title: item.title,
          level: item.level,
          ...(item.completedAt !== undefined && { completedAt: item.completedAt }),
          ...(item.priority !== undefined && { priority: item.priority }),
          ...(item.tags !== undefined && { tags: item.tags }),
          ...(item.description !== undefined && { description: item.description }),
          ...(item.acceptanceCriteria !== undefined && { acceptanceCriteria: item.acceptanceCriteria }),
          parentChain: [...parents],
        });
      }

      if (item.children) {
        walk(item.children, [
          ...parents,
          { id: item.id, title: item.title, level: item.level },
        ]);
      }
    }
  }

  walk(items, []);
  return result;
}

// ---------------------------------------------------------------------------
// Git helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Check whether a git branch exists locally.
 */
function branchExists(dir: string, branch: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", branch], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether this directory is inside a git repository.
 */
function isGitRepo(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-detect the base branch: prefers "main", falls back to "master".
 * Returns "main" as default when neither exists (covers first-ever branch).
 */
function detectBaseBranch(dir: string): string {
  if (branchExists(dir, "main")) return "main";
  if (branchExists(dir, "master")) return "master";
  return "main";
}

// ---------------------------------------------------------------------------
// Epic summary builder
// ---------------------------------------------------------------------------

/**
 * Build per-epic summaries for branch-specific completed items.
 * Groups items by their top-level epic ancestor.
 */
function buildEpicSummaries(
  items: PRDItemShape[],
  branchIds: Set<string>,
): EpicSummary[] {
  const summaryMap = new Map<string, { title: string; count: number }>();

  function countInSubtree(item: PRDItemShape, epicId: string, epicTitle: string): void {
    if (branchIds.has(item.id) && item.level !== "epic") {
      const existing = summaryMap.get(epicId);
      if (existing) {
        existing.count++;
      } else {
        summaryMap.set(epicId, { title: epicTitle, count: 1 });
      }
    }
    if (item.children) {
      for (const child of item.children) {
        countInSubtree(child, epicId, epicTitle);
      }
    }
  }

  for (const item of items) {
    if (item.level === "epic") {
      countInSubtree(item, item.id, item.title);
    }
  }

  return Array.from(summaryMap.entries()).map(([id, { title, count }]) => ({
    id,
    title,
    completedCount: count,
  }));
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

/**
 * Collect completed work items on the current branch that are not
 * present on the base branch.
 *
 * Gracefully handles:
 * - Non-git directories (returns all completed items)
 * - No readable PRD (returns empty result with an error)
 * - Missing or unresolvable base branch (treats all completions as branch
 *   work, and records why in `errors`)
 */
export async function collectBranchWork(
  options: CollectorOptions,
): Promise<BranchWorkResult> {
  const dir = resolve(options.dir);
  const errors: string[] = [];
  const now = new Date().toISOString();
  const readPRD = options.rex?.readPRD ?? readPRDViaRex;
  const diffCompleted = options.rex?.diffCompleted ?? diffCompletedViaRex;

  // ── 1. Determine branch context ──────────────────────────────

  const gitAvailable = isGitRepo(dir);
  const branch = gitAvailable ? (getCurrentBranch(dir) ?? "unknown") : "unknown";

  // A local guess, used only for the "already on the base branch" short
  // circuit below and for results that never reach rex. It is deliberately
  // *not* what gets passed to rex as `--from`: forcing this local guess onto
  // tree-diff overrides its own default resolution (`origin/HEAD`, else local
  // main/master), which is more likely to be right, especially for a local
  // branch that is stale relative to the remote. When rex is actually asked,
  // `result.baseBranch` below is replaced with what it reports comparing
  // against, not this guess.
  const localBaseGuess = options.baseBranch ?? (gitAvailable ? detectBaseBranch(dir) : "main");

  // ── 2. Read the current PRD through rex ──────────────────────
  // Spawned before the diff because `rex tree` migrates a legacy prd.json to
  // the folder tree on the way past, and tree-diff reads the folder tree.

  const currentDoc = readPRD(dir);

  if (!currentDoc) {
    errors.push(`No readable PRD in ${dir} (rex tree --format=json returned nothing usable)`);
    return {
      branch,
      baseBranch: localBaseGuess,
      collectedAt: now,
      items: [],
      errors,
    };
  }

  // Running on the base branch itself — there is no "this branch" to
  // attribute anything to, so diffing it against itself is skipped entirely
  // rather than asked of rex.
  if (gitAvailable && branch === localBaseGuess) {
    return {
      branch,
      baseBranch: localBaseGuess,
      collectedAt: now,
      items: [],
    };
  }

  // ── 3. Ask rex what this branch completed ────────────────────

  let branchIds: Set<string>;
  let baseBranch = localBaseGuess;

  if (gitAvailable) {
    // `options.baseBranch` only — an explicit request is honoured as `--from`,
    // but nothing locally detected is. See the note on `localBaseGuess` above.
    const diffed = diffCompleted(dir, options.baseBranch);
    if (diffed === null) {
      // The base ref did not resolve, or the diff failed. Fall back to the
      // whole completed set, but say so — an unexplained full list reads as a
      // branch that completed everything.
      errors.push(
        `Could not diff against "${localBaseGuess}" — reporting all completed items as branch work`,
      );
      branchIds = collectCompletedIds(currentDoc.items);
    } else {
      baseBranch = diffed.baseBranch;
      if (!diffed.reliable) {
        // Either side of the diff had no PRD tree at all — a legacy project
        // never migrated to the folder tree, or a base ref that predates the
        // PRD. tree-diff's own `completed` array is not "what this branch
        // did" in that case (see diffCompletedViaRex), so this reports no
        // branch work rather than an empty section with no explanation, or
        // the whole project credited to the branch.
        errors.push(
          `"${diffed.baseBranch}" or the working tree has no PRD tree to diff against — ` +
            "reporting no branch work",
        );
        branchIds = new Set();
      } else {
        branchIds = diffed.ids;
      }
    }
  } else {
    // No git, no baseline, nothing to explain: the documented degradation.
    branchIds = collectCompletedIds(currentDoc.items);
  }

  // ── 4. Build enriched results ────────────────────────────────

  const items = buildBranchWorkItems(currentDoc.items, branchIds);
  const epicSummaries = buildEpicSummaries(currentDoc.items, branchIds);

  return {
    branch,
    baseBranch,
    collectedAt: now,
    items,
    ...(epicSummaries.length > 0 && { epicSummaries }),
    ...(errors.length > 0 && { errors }),
  };
}
