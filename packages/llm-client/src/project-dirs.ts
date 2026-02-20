/**
 * Shared project directory constants for the n-dx monorepo.
 *
 * Each n-dx tool stores its data in a dot-directory under the project root:
 * - `.rex/` — PRD tree, config, execution log
 * - `.hench/` — agent config, run history
 * - `.sourcevision/` — analysis output (inventory, imports, zones, components)
 *
 * These constants are the **single source of truth** for directory names.
 * All packages import from here instead of defining their own literals,
 * eliminating the risk of silent drift between CLI and MCP implementations.
 *
 * @example
 * ```ts
 * import { PROJECT_DIRS } from "@n-dx/llm-client";
 *
 * const rexDir = join(projectRoot, PROJECT_DIRS.REX);
 * const henchDir = join(projectRoot, PROJECT_DIRS.HENCH);
 * const svDir = join(projectRoot, PROJECT_DIRS.SOURCEVISION);
 * ```
 */

/** Canonical dot-directory names for each n-dx tool. */
export const PROJECT_DIRS = {
  /** Rex PRD management directory (`.rex/`). */
  REX: ".rex",

  /** Hench autonomous agent directory (`.hench/`). */
  HENCH: ".hench",

  /** SourceVision analysis output directory (`.sourcevision/`). */
  SOURCEVISION: ".sourcevision",
} as const;

/** Type of a single project directory name. */
export type ProjectDir = (typeof PROJECT_DIRS)[keyof typeof PROJECT_DIRS];
