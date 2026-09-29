/**
 * Folder-layout resolver — the one place that decides where n-dx keeps its files.
 *
 * n-dx historically scattered its state across three dot-directories (`.rex/`,
 * `.hench/`, `.sourcevision/`) and five loose `.n-dx*` files at the project
 * root. The target layout gathers all of it under a single `.ndx/` container.
 * Both layouts have to work — a checkout that predates the move must keep
 * running untouched — so every path is resolved through here rather than
 * spelled out at the ~380 sites that name one today.
 *
 * ## Lookup order
 *
 * A `.ndx/` directory at the project root selects the new layout; its absence
 * selects the legacy one. That is the whole rule, and it is deliberately
 * **silent**: a legacy project is not misconfigured, it is just a project that
 * has not run `ndx migrate-layout` yet, so warning about it on every command
 * would be noise. `tests/integration/layout-resolver-contract.test.js` asserts
 * the silence as well as the paths.
 *
 * ## Why `container` is null on legacy
 *
 * There is no `.ndx/` to point at when the legacy layout is in force, and
 * returning the path it *would* have is an invitation for a caller to `mkdir`
 * it and half-migrate the project behind the operator's back. Moving a project
 * is `ndx migrate-layout`'s job and nobody else's, so the field is `null` and a
 * caller that wants the container has to say which layout it means.
 *
 * ## Why the mode override exists
 *
 * `ndx init` and `ndx migrate-layout` need the `.ndx/` paths *before* the
 * container exists — that is precisely what they are about to create. Passing
 * `{ mode: "ndx" }` asks for a layout by name instead of by detection.
 *
 * @module layout
 * @see packages/core/layout.js — the orchestration tier's hand-written twin
 */

import { statSync } from "node:fs";
import { join } from "node:path";

import { PROJECT_DIRS } from "./project-dirs.js";

/** Name of the container directory that selects the new layout. */
export const NDX_CONTAINER_DIRNAME = ".ndx";

/**
 * Which layout a project is on.
 *
 * - `"ndx"` — everything under `.ndx/`.
 * - `"legacy"` — three dot-directories plus five loose `.n-dx*` files.
 */
export type LayoutMode = "ndx" | "legacy";

/**
 * Entry names inside `.ndx/`.
 *
 * The tool directories drop their leading dot (`.rex` → `rex`) and the loose
 * files drop their `.n-dx` prefix (`.n-dx.json` → `config.json`): once
 * everything is inside a hidden container, a second layer of hiding and a
 * repeated product name in every filename carry no information.
 */
const NDX_ENTRIES = {
  REX: "rex",
  HENCH: "hench",
  SOURCEVISION: "sourcevision",
  CONFIG: "config.json",
  LOCAL_CONFIG: "config.local.json",
  WEB_PID: "web.pid",
  WEB_PORT: "web.port",
  WEB_USAGE: "web-usage.jsonl",
} as const;

/**
 * Root-relative names in the legacy layout.
 *
 * The three directories come from {@link PROJECT_DIRS}, which already is their
 * single source of truth; duplicating them here would create a second one.
 */
const LEGACY_ENTRIES = {
  REX: PROJECT_DIRS.REX,
  HENCH: PROJECT_DIRS.HENCH,
  SOURCEVISION: PROJECT_DIRS.SOURCEVISION,
  CONFIG: ".n-dx.json",
  LOCAL_CONFIG: ".n-dx.local.json",
  WEB_PID: ".n-dx-web.pid",
  WEB_PORT: ".n-dx-web.port",
  WEB_USAGE: ".n-dx-web-usage.jsonl",
} as const;

/** Every path n-dx owns inside a project, already joined to the project root. */
export interface Layout {
  /** Which layout was resolved. */
  mode: LayoutMode;
  /** The project root the paths below are anchored to. */
  root: string;
  /** The `.ndx/` container, or `null` on the legacy layout — see the module note. */
  container: string | null;
  /** Rex PRD state (`.ndx/rex` or `.rex`). */
  rexDir: string;
  /** Hench agent state (`.ndx/hench` or `.hench`). */
  henchDir: string;
  /** SourceVision analysis output (`.ndx/sourcevision` or `.sourcevision`). */
  sourcevisionDir: string;
  /** Project config overrides (`.ndx/config.json` or `.n-dx.json`). */
  configFile: string;
  /** Machine-local config overrides (`.ndx/config.local.json` or `.n-dx.local.json`). */
  localConfigFile: string;
  /** Dashboard PID marker (`.ndx/web.pid` or `.n-dx-web.pid`). */
  webPidFile: string;
  /** Dashboard port marker (`.ndx/web.port` or `.n-dx-web.port`). */
  webPortFile: string;
  /** Dashboard LLM spend ledger (`.ndx/web-usage.jsonl` or `.n-dx-web-usage.jsonl`). */
  webUsageFile: string;
}

/** Options accepted by {@link resolveLayout}. */
export interface ResolveLayoutOptions {
  /**
   * Resolve this layout instead of detecting one.
   *
   * For `ndx init` and `ndx migrate-layout`, which need the target paths before
   * the container they are about to create exists.
   */
  mode?: LayoutMode;
}

/**
 * Which layout `root` is on, decided by whether `.ndx/` is a directory there.
 *
 * Never throws and never prints: an unreadable or missing root is simply not on
 * the new layout, which is the same answer the legacy fallback gives.
 */
export function detectLayoutMode(root: string): LayoutMode {
  const stats = statSync(join(root, NDX_CONTAINER_DIRNAME), {
    throwIfNoEntry: false,
  });
  return stats?.isDirectory() === true ? "ndx" : "legacy";
}

/**
 * Resolve every n-dx path for a project root.
 *
 * @param root     Absolute project root.
 * @param options  Pass `{ mode }` to bypass detection — see {@link ResolveLayoutOptions}.
 */
export function resolveLayout(
  root: string,
  options: ResolveLayoutOptions = {},
): Layout {
  const mode = options.mode ?? detectLayoutMode(root);

  if (mode === "ndx") {
    const container = join(root, NDX_CONTAINER_DIRNAME);
    return {
      mode,
      root,
      container,
      rexDir: join(container, NDX_ENTRIES.REX),
      henchDir: join(container, NDX_ENTRIES.HENCH),
      sourcevisionDir: join(container, NDX_ENTRIES.SOURCEVISION),
      configFile: join(container, NDX_ENTRIES.CONFIG),
      localConfigFile: join(container, NDX_ENTRIES.LOCAL_CONFIG),
      webPidFile: join(container, NDX_ENTRIES.WEB_PID),
      webPortFile: join(container, NDX_ENTRIES.WEB_PORT),
      webUsageFile: join(container, NDX_ENTRIES.WEB_USAGE),
    };
  }

  return {
    mode,
    root,
    container: null,
    rexDir: join(root, LEGACY_ENTRIES.REX),
    henchDir: join(root, LEGACY_ENTRIES.HENCH),
    sourcevisionDir: join(root, LEGACY_ENTRIES.SOURCEVISION),
    configFile: join(root, LEGACY_ENTRIES.CONFIG),
    localConfigFile: join(root, LEGACY_ENTRIES.LOCAL_CONFIG),
    webPidFile: join(root, LEGACY_ENTRIES.WEB_PID),
    webPortFile: join(root, LEGACY_ENTRIES.WEB_PORT),
    webUsageFile: join(root, LEGACY_ENTRIES.WEB_USAGE),
  };
}
