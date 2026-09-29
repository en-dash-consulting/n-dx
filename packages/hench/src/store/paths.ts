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

import { resolveLayout, type ResolveLayoutOptions } from "../prd/llm-gateway.js";

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
