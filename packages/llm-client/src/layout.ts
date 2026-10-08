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
 * ## The per-user directory
 *
 * {@link resolveNdxHome} answers the same question one level up, for the hub's
 * machine-wide state. It is deliberately a separate function rather than a
 * field on {@link Layout}: the hub's directory belongs to the user, not to any
 * project, and a project root is not an input to it.
 *
 * @module layout
 * @see packages/core/layout.js — the orchestration tier's hand-written twin
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";

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
  return isDirectory(join(root, NDX_CONTAINER_DIRNAME)) ? "ndx" : "legacy";
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

/**
 * A resolved path as `.gitignore` and `.gitattributes` need to see it: relative
 * to the project root, with forward slashes.
 *
 * `ndx init` writes both files, and every pattern in them names a directory
 * this module owns — so on the new layout they have to say `.ndx/rex/…` where
 * they used to say `.rex/…`. Doing that by hand at each call site is how the
 * literals this module exists to remove get reintroduced, one gitignore line at
 * a time. Forward slashes are not cosmetic: git's pattern syntax has no
 * backslash-separated form, so a Windows `path.relative` result written
 * verbatim silently matches nothing.
 */
export function relativeToRoot(layout: Layout, path: string): string {
  return relative(layout.root, path).split(sep).join("/");
}

/**
 * The project root a resolved state directory belongs to.
 *
 * Packages pass their own state directory around (`/project/.rex`,
 * `/project/.ndx/hench`) and used to recover the project root as its parent.
 * On the `.ndx/` layout the parent is the container, and resolving a layout
 * *there* finds no `.ndx/` inside it, selects legacy, and reads
 * `/project/.ndx/.n-dx.json` — a file nothing writes — so every project
 * override was silently ignored on a migrated project. Stepping over the
 * container is this module's knowledge, not the caller's: every state
 * directory it resolves sits either at the root or one level inside the
 * container, and nowhere else.
 */
export function projectRootOf(stateDir: string): string {
  const parent = dirname(stateDir);
  return basename(parent) === NDX_CONTAINER_DIRNAME ? dirname(parent) : parent;
}

/** What {@link layoutStateNames} answers with. */
export interface LayoutStateNames {
  /**
   * Single path segments, for a scan that tests one directory entry at a time:
   * `.ndx`, `.rex`, `.hench`, `.sourcevision`. The container alone stands in
   * for all three of its children, because skipping it skips them.
   */
  dirNames: string[];
  /**
   * Full root-relative paths, for matching a path something else produced:
   * `.ndx/rex`, `.ndx/hench`, `.ndx/sourcevision` and the three legacy
   * directories.
   */
  statePaths: string[];
}

/**
 * Every root-relative name n-dx keeps state under, in **both** layouts.
 *
 * For *classifiers* rather than path constructors — code that is handed a path
 * by git, by `readdir` or by a source file's import specifier and has to answer
 * "is this n-dx's own state?". A classifier that resolved the one layout the
 * project happens to be on would give a different answer depending on where it
 * runs: a `.ndx/` checkout would stop recognising a `.rex/` import that is
 * still wrong, and a legacy checkout would stop recognising `.ndx/rex/`.
 *
 * Accepting both is not a false positive waiting to happen — `.ndx/` present
 * *is* the new layout, so no project has both shapes — and it spares every
 * call site from threading a project root down to a string match. The same
 * argument, and the same shape, as `PRD_COMMIT_PATHS` in hench's
 * uncommitted-work gate and `HENCH_RUNTIME_GITIGNORE_ENTRIES` in its artifact
 * store.
 *
 * Anything that *writes*, or reads one known file, must use
 * {@link resolveLayout} instead: staging or opening both spellings names a
 * path that does not exist.
 *
 * Forward slashes, for the same reason {@link relativeToRoot} uses them.
 */
export function layoutStateNames(): LayoutStateNames {
  const legacy = resolveLayout(".", { mode: "legacy" });
  const ndx = resolveLayout(".", { mode: "ndx" });
  const legacyDirs = [legacy.rexDir, legacy.henchDir, legacy.sourcevisionDir].map((p) =>
    relativeToRoot(legacy, p),
  );
  const ndxDirs = [ndx.rexDir, ndx.henchDir, ndx.sourcevisionDir].map((p) =>
    relativeToRoot(ndx, p),
  );
  return {
    dirNames: [...legacyDirs, NDX_CONTAINER_DIRNAME],
    statePaths: [...legacyDirs, ...ndxDirs],
  };
}

// ---------------------------------------------------------------------------
// The per-user directory
// ---------------------------------------------------------------------------

/** Directory name of the per-user home, under the user's home directory. */
export const NDX_HOME_DIRNAME = ".ndx";

/** What the per-user home was called before the layout move. */
export const LEGACY_NDX_HOME_DIRNAME = ".n-dx";

/** Environment variable that overrides the per-user home outright. */
export const NDX_HOME_ENV = "NDX_HOME";

/** The override's previous name, still honoured when {@link NDX_HOME_ENV} is unset. */
export const LEGACY_NDX_HOME_ENV = "N_DX_HOME";

/** Options accepted by {@link resolveNdxHome}. */
export interface ResolveNdxHomeOptions {
  /**
   * Environment to read the overrides from. Defaults to `process.env`.
   *
   * Injected rather than read globally so a test can state the environment it
   * means instead of mutating the process's and restoring it in a `finally`.
   */
  env?: Record<string, string | undefined>;
  /** The user's home directory. Defaults to `os.homedir()`. */
  home?: string;
}

/**
 * Where n-dx keeps its machine-wide state — the hub's registry, pid and config.
 *
 * ## Lookup order
 *
 * 1. `$NDX_HOME`
 * 2. `$N_DX_HOME` — the override's previous name
 * 3. `~/.ndx` when it already exists
 * 4. `~/.n-dx` when it already exists
 * 5. `~/.ndx` — what a machine with neither gets
 *
 * Steps 3 and 4 are the same "detect, don't assume" rule {@link resolveLayout}
 * applies to a project: a machine that only ever ran 0.7.x has its hub state in
 * `~/.n-dx`, and moving it out from under a running hub is not something a path
 * lookup gets to decide. Step 5 means a fresh install starts on the new name
 * without anyone having to migrate anything.
 *
 * An empty-string override is treated as unset — `NDX_HOME=` in a shell profile
 * means "I did not set this", and honouring it literally would put the hub's
 * registry in the process's working directory.
 */
export function resolveNdxHome(options: ResolveNdxHomeOptions = {}): string {
  const env = options.env ?? process.env;

  const override = env[NDX_HOME_ENV] || env[LEGACY_NDX_HOME_ENV];
  if (override) return override;

  const home = options.home ?? homedir();
  const current = join(home, NDX_HOME_DIRNAME);
  if (isDirectory(current)) return current;

  const legacy = join(home, LEGACY_NDX_HOME_DIRNAME);
  if (isDirectory(legacy)) return legacy;

  return current;
}

/** Never throws: an unreadable path is simply not a directory. */
function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}
