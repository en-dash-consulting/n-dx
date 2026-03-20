/**
 * Shared project directory constants for the n-dx monorepo.
 *
 * All n-dx tool data is stored under a single `.n-dx/` directory at the
 * project root, with per-tool subdirectories:
 * - `.n-dx/rex/` — PRD tree, config, execution log
 * - `.n-dx/hench/` — agent config, run history
 * - `.n-dx/sourcevision/` — analysis output (inventory, imports, zones, components)
 *
 * These constants are the **single source of truth** for directory names.
 * All packages import from here instead of defining their own literals,
 * eliminating the risk of silent drift between CLI and MCP implementations.
 *
 * @example
 * ```ts
 * import { PROJECT_DIRS, PROJECT_FILES } from "@n-dx/llm-client";
 *
 * const rexDir = join(projectRoot, PROJECT_DIRS.REX);
 * const henchDir = join(projectRoot, PROJECT_DIRS.HENCH);
 * const svDir = join(projectRoot, PROJECT_DIRS.SOURCEVISION);
 * const configPath = join(projectRoot, PROJECT_FILES.CONFIG);
 * ```
 */

/** Root `.n-dx/` directory under the project root. */
export const PROJECT_ROOT_DIR = ".n-dx" as const;

/** Canonical dot-directory paths for each n-dx tool (relative to project root). */
export const PROJECT_DIRS = {
  /** Root n-dx directory (`.n-dx/`). */
  ROOT: ".n-dx",

  /** Rex PRD management directory (`.n-dx/rex/`). */
  REX: ".n-dx/rex",

  /** Hench autonomous agent directory (`.n-dx/hench/`). */
  HENCH: ".n-dx/hench",

  /** SourceVision analysis output directory (`.n-dx/sourcevision/`). */
  SOURCEVISION: ".n-dx/sourcevision",
} as const;

/** Well-known files within the `.n-dx/` directory (relative to project root). */
export const PROJECT_FILES = {
  /** Project-level config (`.n-dx/config.json`). */
  CONFIG: ".n-dx/config.json",

  /** Web server PID file (`.n-dx/web.pid`). */
  PID: ".n-dx/web.pid",

  /** Web server port file (`.n-dx/web.port`). */
  PORT: ".n-dx/web.port",
} as const;

/**
 * Legacy directory names (pre-consolidation).
 * Used by migration logic to detect and move old-style directories.
 */
export const LEGACY_DIRS = {
  REX: ".rex",
  HENCH: ".hench",
  SOURCEVISION: ".sourcevision",
} as const;

/** Legacy file names (pre-consolidation). */
export const LEGACY_FILES = {
  CONFIG: ".n-dx.json",
  PID: ".n-dx-web.pid",
  PORT: ".n-dx-web.port",
} as const;

/** Type of a single project directory name. */
export type ProjectDir = (typeof PROJECT_DIRS)[keyof typeof PROJECT_DIRS];
