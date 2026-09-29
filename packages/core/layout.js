/**
 * Folder-layout resolver for the orchestration tier.
 *
 * This is a hand-written twin of `packages/llm-client/src/layout.ts`. The
 * duplication is deliberate and not drift: orchestration scripts must not
 * import from any package tier — `tests/e2e/domain-isolation.test.js` fails
 * `cli.js`, `ci.js`, `web.js`, `config.js`, `pr-check.js` and
 * `claude-integration.js` for importing `@n-dx/llm-client` at all — yet every
 * one of them needs to know where `.rex/`, `.hench/` and the loose `.n-dx*`
 * files live. Spawning a CLI to ask for a path would be a child process per
 * path lookup, so the rule is copied instead.
 *
 * Two copies of a rule drift silently, so
 * `tests/integration/layout-resolver-contract.test.js` pins this module to the
 * llm-client one: same mode for the same root, same path for every field, in
 * both layouts. Change one side and that test fails until the other follows.
 *
 * The lookup order, the silence, the `null` container and the mode override all
 * carry the reasoning documented on the llm-client module — read that one first.
 * The same applies to {@link resolveNdxHome}, the per-user directory the hub
 * keeps its registry in, which `web.js` needs for exactly the same reason.
 *
 * @module n-dx/layout
 * @see packages/llm-client/src/layout.ts — the canonical implementation
 */

import { statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Name of the container directory that selects the new layout. */
export const NDX_CONTAINER_DIRNAME = ".ndx";

/**
 * Which layout a project is on.
 *
 * @typedef {"ndx" | "legacy"} LayoutMode
 */

/**
 * Every path n-dx owns inside a project, already joined to the project root.
 *
 * @typedef {object} Layout
 * @property {LayoutMode} mode          Which layout was resolved.
 * @property {string} root              The project root the paths are anchored to.
 * @property {string | null} container  The `.ndx/` directory, or `null` on legacy.
 * @property {string} rexDir            Rex PRD state.
 * @property {string} henchDir          Hench agent state.
 * @property {string} sourcevisionDir   SourceVision analysis output.
 * @property {string} configFile        Project config overrides.
 * @property {string} localConfigFile   Machine-local config overrides.
 * @property {string} webPidFile        Dashboard PID marker.
 * @property {string} webPortFile       Dashboard port marker.
 * @property {string} webUsageFile      Dashboard LLM spend ledger.
 */

/** Entry names inside `.ndx/`. Mirrors `NDX_ENTRIES` in the llm-client twin. */
const NDX_ENTRIES = {
  REX: "rex",
  HENCH: "hench",
  SOURCEVISION: "sourcevision",
  CONFIG: "config.json",
  LOCAL_CONFIG: "config.local.json",
  WEB_PID: "web.pid",
  WEB_PORT: "web.port",
  WEB_USAGE: "web-usage.jsonl",
};

/** Root-relative names in the legacy layout. Mirrors `LEGACY_ENTRIES` in the twin. */
const LEGACY_ENTRIES = {
  REX: ".rex",
  HENCH: ".hench",
  SOURCEVISION: ".sourcevision",
  CONFIG: ".n-dx.json",
  LOCAL_CONFIG: ".n-dx.local.json",
  WEB_PID: ".n-dx-web.pid",
  WEB_PORT: ".n-dx-web.port",
  WEB_USAGE: ".n-dx-web-usage.jsonl",
};

/**
 * Which layout `root` is on, decided by whether `.ndx/` is a directory there.
 *
 * Never throws and never prints — a legacy project is not a misconfigured one.
 *
 * @param {string} root  Project root.
 * @returns {LayoutMode}
 */
export function detectLayoutMode(root) {
  return isDirectory(join(root, NDX_CONTAINER_DIRNAME)) ? "ndx" : "legacy";
}

/**
 * Resolve every n-dx path for a project root.
 *
 * @param {string} root  Absolute project root.
 * @param {{mode?: LayoutMode}} [options]  Pass `mode` to bypass detection —
 *   `ndx init` and `ndx migrate-layout` need the target paths before the
 *   container they are about to create exists.
 * @returns {Layout}
 */
export function resolveLayout(root, options = {}) {
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

// ---------------------------------------------------------------------------
// The per-user directory
// ---------------------------------------------------------------------------

/** Directory name of the per-user home, under the user's home directory. */
export const NDX_HOME_DIRNAME = ".ndx";

/** What the per-user home was called before the layout move. */
export const LEGACY_NDX_HOME_DIRNAME = ".n-dx";

/** Environment variable that overrides the per-user home outright. */
export const NDX_HOME_ENV = "NDX_HOME";

/** The override's previous name, still honoured when `NDX_HOME` is unset. */
export const LEGACY_NDX_HOME_ENV = "N_DX_HOME";

/**
 * Where n-dx keeps its machine-wide state — the hub's registry, pid and config.
 *
 * Lookup order: `$NDX_HOME`, `$N_DX_HOME`, `~/.ndx` when it exists, `~/.n-dx`
 * when it exists, else `~/.ndx`. The reasoning is on the llm-client twin; read
 * that one first.
 *
 * @param {{env?: Record<string, string | undefined>, home?: string}} [options]
 *   Injection points for tests — default to `process.env` and `os.homedir()`.
 * @returns {string}
 */
export function resolveNdxHome(options = {}) {
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
function isDirectory(path) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}
