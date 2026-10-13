/**
 * Hench's paths module — the only place hench names a folder of its own.
 *
 * The subdirectory names below were each declared privately at the module that
 * used them (`"runs"` in `store/config.ts` and `process/lifecycle.ts`,
 * `"locks"` in two more, `"usage-cursors"` in `store/session-usage.ts`,
 * `".hench/recovery"` spelled out whole in the uncommitted-work gate). Gathering
 * them here is the point of the exercise: where `.hench/` itself lives now
 * depends on which layout the project is on, and a name that is declared four
 * times is a name that can be moved three times.
 *
 * ## Why this reaches llm-client through the gateway
 *
 * `packages/core/gateway-rules.json` gates hench's foundation-tier imports
 * through `prd/llm-gateway.ts`; only `cli/errors.ts` is exempt. `store/` is
 * permitted to import from `prd/` — the intra-hench rule bars the reverse
 * direction and bars `cli/errors.ts` specifically (see
 * `packages/hench/tests/integration/zone-boundary.test.ts`).
 *
 * @module hench/store/paths
 * @see packages/llm-client/src/layout.ts — the resolver and its lookup order
 */

import { join } from "node:path";

import {
  relativeToRoot,
  resolveLayout,
  type LayoutMode,
  type ResolveLayoutOptions,
} from "../prd/llm-gateway.js";
import { PRD_CACHE_DIRNAME, PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../prd/rex-gateway.js";

/**
 * The v2 layer folders under rex's state directory. Spelled here because
 * rex's public API does not export `PRODUCT_DIRNAME` / `CHANGES_DIRNAME`
 * (they live in `store/prd-model-reader.ts`); switch to a gateway re-export
 * once rex exports them.
 */
export const V2_PRODUCT_DIRNAME = "product";
export const V2_CHANGES_DIRNAME = "changes";
/** Where unplaced changes wait, under changes/ (rex's `INBOX_DIRNAME`). */
export const V2_INBOX_DIRNAME = "inbox";
/** A v2 node folder's tool-state file; its intent files are the folder's `.md` files. */
export const V2_STATE_FILENAME = "state.yaml";

/** Which tool's state directory {@link stateDirNameUnder} is asked about. */
export type StateDirKey = "rex" | "hench" | "sourcevision";

/**
 * One tool's state directory under a *named* layout, spelled the way a git
 * pathspec has to spell it — `.hench` or `.ndx/hench`, `.rex` or `.ndx/rex`.
 *
 * For the **classifiers**: the lists that answer "is this path hench's own
 * bookkeeping?" about a line git handed them, and so have to recognise both
 * layouts rather than resolve one (see `HENCH_RUNTIME_GITIGNORE_ENTRIES` in
 * `store/artifacts.ts` and `PRD_COMMIT_PATHS` in the uncommitted-work gate).
 * Anything that writes a path, or reads one known file, calls
 * {@link resolveHenchPaths} or the resolver directly instead: a writer has to
 * pick one layout, and naming the other one stages nothing at all.
 *
 * `"."` as the root is not a lookup — an explicit `mode` skips detection
 * entirely, so nothing touches the disk and the result is purely the name. The
 * point is that no spelling is written out at the call sites: all of them come
 * from the resolver, so a rename there reaches every pattern built from this.
 *
 * It lives here, rather than once per consumer, because it had been copied
 * three times (`henchDirNameUnder` in `store/artifacts.ts`, `rexDirNameUnder`
 * in the gate, and an inline pair in `validation/changed-files.ts`) and a
 * fourth copy was about to be written.
 */
export function stateDirNameUnder(which: StateDirKey, mode: LayoutMode): string {
  const layout = resolveLayout(".", { mode });
  const dir =
    which === "rex" ? layout.rexDir : which === "hench" ? layout.henchDir : layout.sourcevisionDir;
  return relativeToRoot(layout, dir);
}

/**
 * What rex writes inside its state directory that is bookkeeping rather than
 * project content, relative to that directory.
 *
 * Entries ending in `/` are directories; the rest are exact file names. Both
 * are matched by `matchesProjectPath` in `store/artifacts.ts`, which is why
 * this is one flat list rather than two.
 *
 * `prd_tree/` is here because hench dirties the task's `index.md` itself: the
 * `rex_update_status` write lands before the agent has done anything, so a run
 * that produced nothing would otherwise always look like it had changed a
 * file. The rest are rex's own records — the execution log and its one
 * rotation, the derived cache the dashboard's watcher rewrites, the tree
 * metadata, the prune/reshape archive, queued proposals, and the findings the
 * reviewer has acknowledged.
 *
 * What is deliberately **absent** is the point of the list. `workflow.md` goes
 * into every agent brief and `config.json` is project configuration: both are
 * content a task can legitimately be about, and under the blanket `.rex/`
 * prefix this replaced, a run whose only change was one of them was read as
 * "no changes", skipped the test gate, and could never complete.
 */
const REX_BOOKKEEPING_ENTRIES: readonly string[] = [
  // Names rex owns, read from it rather than spelled again here: a rename on
  // rex's side that this list did not follow would silently stop discounting
  // the thing it names.
  `${PRD_TREE_DIRNAME}/`,
  `${PRD_CACHE_DIRNAME}/`,
  // A v2 tree's layers, prd_tree/'s counterparts: completing a task writes
  // changes/<change>/state.yaml, and applying a change writes product/.
  `${V2_PRODUCT_DIRNAME}/`,
  `${V2_CHANGES_DIRNAME}/`,
  "execution-log.jsonl",
  // `core/execution-log.ts` rotates at 1 MB and keeps exactly one generation.
  // Listed rather than glob-matched: `matchesProjectPath` compares literals,
  // and a second generation would be a change in rex, not a silent gap here.
  "execution-log.1.jsonl",
  TREE_META_FILENAME,
  "archive.json",
  "pending-proposals.json",
  "acknowledged-findings.json",
  // Locks and the backup store. The blanket `.rex/` prefix this list replaced
  // covered them; `rex init` does not, because it appends only
  // n-dx_workflow.md, execution-log*.jsonl and the derived cache — the lock
  // and backup patterns live in the ndx.gitignore block an operator pastes by
  // hand. On a project that skipped that paste they are untracked, so a lock
  // held while the end-of-run snapshot is taken (the dashboard, an MCP write)
  // read as the run's own changed work and fired the full-suite gate.
  //
  // Literals rather than rex's constants: PRD_LOCK_FILENAME and
  // RESHAPE_LOCK_FILENAME are not on rex's public surface, and widening it for
  // three file names would cost more than it buys. Same reasoning as
  // execution-log.1.jsonl above.
  "prd.lock",
  "prd.json.lock",
  "reshape.lock",
  ".backups/",
];

/**
 * @param mode Layout to spell the paths for.
 * @returns Bookkeeping paths under that layout, project-relative.
 */
function bookkeepingPathsUnder(mode: LayoutMode): string[] {
  const rexDir = stateDirNameUnder("rex", mode);
  return [
    // All of hench's own state is bookkeeping: run records, locks, usage
    // cursors, reviewer reports. Nothing in there is ever a work product.
    `${stateDirNameUnder("hench", mode)}/`,
    ...REX_BOOKKEEPING_ENTRIES.map((entry) => `${rexDir}/${entry}`),
  ];
}

/**
 * Every path, in **both** layouts, that is hench's or rex's bookkeeping rather
 * than a run's work.
 *
 * Two gates ask that question — `validation/changed-files.ts` (is the
 * full-suite gate worth running?) and the reviewer-diff filter in
 * `agent/lifecycle/cli-loop.ts` (did the reviewer repair anything?) — and the
 * diff summary in `validation/completion.ts` builds its git pathspec excludes
 * from the same list, so none of the three can disagree about what counts as
 * work.
 *
 * This used to be three directory prefixes: `.rex/`, `.hench/` and `.ndx/`.
 * That was too blunt in both directions. Under `.rex/` it swallowed
 * `workflow.md` and `config.json`, which are project content — a task that
 * only edits the workflow could never complete through `ndx work` (#539).
 * Under `.ndx/` it swallowed the whole container, including
 * `.ndx/sourcevision/`, while the legacy layout counted `.sourcevision/` as a
 * change; the two layouts now agree, and analysis output is a change in both.
 */
export const BOOKKEEPING_PATHS: readonly string[] = [
  ...bookkeepingPathsUnder("legacy"),
  ...bookkeepingPathsUnder("ndx"),
];

/** Hench's config file inside its state directory. */
export const HENCH_CONFIG_FILENAME = "config.json";

/** Per-run records, one directory per run. Machine-local history. */
export const RUNS_DIRNAME = "runs";

/** Concurrency locks held by in-flight runs. */
export const LOCKS_DIRNAME = "locks";

/** Per-session watermarks for transcript token attribution. Safe to delete. */
export const USAGE_CURSORS_DIRNAME = "usage-cursors";

/** Adversarial-review reports, one JSON file per run. */
export const REVIEWS_DIRNAME = "reviews";

/** Pathspec files the uncommitted-work gate's recovery commands read. */
export const RECOVERY_DIRNAME = "recovery";

/** Per-run MCP server configs handed to the spawned agent session. */
export const AGENT_MCP_DIRNAME = "mcp";

/** Every path hench owns inside a project, already joined to the project root. */
export interface HenchPaths {
  /** Hench's state directory — `.ndx/hench` or `.hench`. */
  henchDir: string;
  /** Hench's config file. */
  configPath: string;
  /** Per-run records. */
  runsDir: string;
  /** Concurrency locks. */
  locksDir: string;
  /** Transcript attribution watermarks. */
  usageCursorsDir: string;
  /** Adversarial-review reports. */
  reviewsDir: string;
  /** Uncommitted-work-gate recovery pathspecs. */
  recoveryDir: string;
  /** Per-run MCP server configs. */
  agentMcpDir: string;
}

/**
 * Resolve hench's paths for a project root.
 *
 * @param root     Absolute project root (the directory *containing* `.hench/`).
 * @param options  Forwarded to {@link resolveLayout} — pass `{ mode }` to ask
 *                 for a layout by name rather than detecting one.
 */
export function resolveHenchPaths(
  root: string,
  options?: ResolveLayoutOptions,
): HenchPaths {
  const { henchDir } = resolveLayout(root, options);
  return {
    henchDir,
    configPath: join(henchDir, HENCH_CONFIG_FILENAME),
    runsDir: join(henchDir, RUNS_DIRNAME),
    locksDir: join(henchDir, LOCKS_DIRNAME),
    usageCursorsDir: join(henchDir, USAGE_CURSORS_DIRNAME),
    reviewsDir: join(henchDir, REVIEWS_DIRNAME),
    recoveryDir: join(henchDir, RECOVERY_DIRNAME),
    agentMcpDir: join(henchDir, AGENT_MCP_DIRNAME),
  };
}
