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
  NDX_CONTAINER_DIRNAME,
  relativeToRoot,
  resolveLayout,
  type LayoutMode,
  type ResolveLayoutOptions,
} from "../prd/llm-gateway.js";

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
 * Where hench's and rex's state sits, in **both** layouts, as path prefixes
 * with a trailing slash — `.rex/`, `.hench/`, `.ndx/`.
 *
 * A path under one of these is bookkeeping rather than work: the agent's own
 * `rex_update_status` write, hench's completion commit, a run record, a
 * reviewer report. Two gates ask that question — `validation/changed-files.ts`
 * (is the full-suite gate worth running?) and the reviewer-diff filter in
 * `agent/lifecycle/cli-loop.ts` (did the reviewer repair anything?) — and
 * before this list was shared they each spelled the three prefixes out, so the
 * two could disagree about what counts as work.
 *
 * One entry covers the new layout: everything n-dx owns is inside the
 * container, so `.ndx/` subsumes `.ndx/rex` and `.ndx/hench` both.
 *
 * Deliberately **not** including sourcevision. Analysis output is not hench's
 * bookkeeping, and on the legacy layout a run that rewrote `.sourcevision/`
 * has changed something the gates should see. (The container entry does sweep
 * `.ndx/sourcevision` in with the rest on the new layout — an asymmetry that
 * predates this constant and is not changed here.)
 */
export const BOOKKEEPING_DIR_PREFIXES: readonly string[] = [
  `${stateDirNameUnder("rex", "legacy")}/`,
  `${stateDirNameUnder("hench", "legacy")}/`,
  `${NDX_CONTAINER_DIRNAME}/`,
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
