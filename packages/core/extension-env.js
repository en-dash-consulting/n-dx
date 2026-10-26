/**
 * The environment every extension process gets, CLI command and sidecar alike
 * (docs/architecture/extensions.md, "Environment every extension process gets").
 *
 * The user's own environment, plus the contract variables:
 *
 * | Variable                  | Value |
 * | ------------------------- | ----- |
 * | `NDX_EXTENSION_API`       | The contract version this n-dx speaks |
 * | `NDX_VERSION`             | The running n-dx version |
 * | `NDX_BIN`                 | This install's `cli.js`; run it with Node (`process.execPath` in the extension is n-dx's own) |
 * | `NDX_HOME`                | The resolved n-dx home |
 * | `NDX_EXTENSION_NAME`      | The manifest `name` |
 * | `NDX_EXTENSION_STATE_DIR` | `<ndx home>/ext/<name>/`, created here |
 * | `NDX_EXTENSION_CONFIG`    | A JSON file holding the extension's config section |
 * | `NDX_HUB_URL`             | The running hub's base URL; unset when no hub runs |
 * | `NDX_TOKEN_FILE`          | The per-user token file; only with `NDX_HUB_URL`, and only when it exists |
 *
 * The token itself is never read here, so it can never reach an extension's
 * environment. A contract variable inherited from the caller (an extension
 * that runs `ndx` which runs another extension) is replaced or removed, so a
 * stale hub URL never survives the hub.
 *
 * @module n-dx/extension-env
 */

import * as nodeFs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_EXTENSION_API_VERSIONS } from "./extension-manifest.js";

/** The contract version n-dx speaks: the newest it supports. */
export const EXTENSION_API_VERSION = Math.max(...SUPPORTED_EXTENSION_API_VERSIONS);

/** Under the n-dx home, one folder per extension name. */
export const EXTENSION_STATE_DIRNAME = "ext";

/**
 * The file `NDX_EXTENSION_CONFIG` names, in the extension's state folder. It
 * holds `{}` until per-extension config sections fill it (feature F3).
 */
export const EXTENSION_CONFIG_FILENAME = "ndx-config.json";

/** Every variable the contract sets; inherited copies are dropped first. */
export const EXTENSION_ENV_VARS = Object.freeze([
  "NDX_EXTENSION_API",
  "NDX_VERSION",
  "NDX_BIN",
  "NDX_HOME",
  "NDX_EXTENSION_NAME",
  "NDX_EXTENSION_STATE_DIR",
  "NDX_EXTENSION_CONFIG",
  "NDX_HUB_URL",
  "NDX_TOKEN_FILE",
]);

/** This install's CLI entry: what `NDX_BIN` re-enters. */
export const NDX_CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "cli.js");

// The hub's own files in the n-dx home (packages/web/src/hub/registry.ts and
// core's web.js name the same ones; the orchestration tier cannot import web).
const HUB_PID_FILE = "hub.pid";
const AUTH_TOKEN_FILE = "auth.token";

/**
 * @typedef {Pick<typeof nodeFs, "existsSync" | "mkdirSync" | "readFileSync" | "writeFileSync">} ExtensionEnvFs
 */

/**
 * @typedef {object} ExtensionEnvOptions
 * @property {string} name  The manifest `name`.
 * @property {string} home  The resolved n-dx home.
 * @property {string} ndxVersion  The running n-dx.
 * @property {Record<string, string | undefined>} [baseEnv]  The user's environment; defaults to `process.env`.
 * @property {string} [ndxBin]  Defaults to {@link NDX_CLI_PATH}.
 * @property {ExtensionEnvFs} [fs]
 * @property {(pid: number) => boolean} [isAlive]  Defaults to a `kill(pid, 0)` probe.
 */

/** `<home>/ext/<name>`. */
export function extensionStateDir(home, name) {
  return join(home, EXTENSION_STATE_DIRNAME, name);
}

/**
 * The environment for one extension process. Creates the state folder and the
 * config file; throws when it cannot, since the contract promises both.
 *
 * @param {ExtensionEnvOptions} options
 * @returns {Record<string, string | undefined>}
 */
export function extensionEnvironment(options) {
  const fs = options.fs ?? nodeFs;
  const stateDir = extensionStateDir(options.home, options.name);
  const configFile = join(stateDir, EXTENSION_CONFIG_FILENAME);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(configFile, "{}\n");

  const env = { ...(options.baseEnv ?? process.env) };
  for (const key of EXTENSION_ENV_VARS) delete env[key];

  Object.assign(env, {
    NDX_EXTENSION_API: String(EXTENSION_API_VERSION),
    NDX_VERSION: options.ndxVersion,
    NDX_BIN: options.ndxBin ?? NDX_CLI_PATH,
    NDX_HOME: options.home,
    NDX_EXTENSION_NAME: options.name,
    NDX_EXTENSION_STATE_DIR: stateDir,
    NDX_EXTENSION_CONFIG: configFile,
  });

  const hub = runningHub(options.home, fs, options.isAlive ?? isPidAlive);
  if (hub) {
    env.NDX_HUB_URL = hub.url;
    if (hub.tokenFile) env.NDX_TOKEN_FILE = hub.tokenFile;
  }
  return env;
}

/**
 * The hub this home's `hub.pid` names, when its process is alive.
 *
 * @param {string} home
 * @param {ExtensionEnvFs} fs
 * @param {(pid: number) => boolean} isAlive
 * @returns {{url: string, tokenFile: string | undefined} | null}
 */
function runningHub(home, fs, isAlive) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(join(home, HUB_PID_FILE), "utf-8"));
  } catch {
    return null; // no hub.pid, or one being rewritten: no hub to name
  }
  const { pid, port } = record ?? {};
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (!isAlive(pid)) return null;
  const tokenFile = join(home, AUTH_TOKEN_FILE);
  return { url: `http://localhost:${port}`, tokenFile: fs.existsSync(tokenFile) ? tokenFile : undefined };
}

/** @param {number} pid */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return /** @type {NodeJS.ErrnoException} */ (err).code === "EPERM";
  }
}
