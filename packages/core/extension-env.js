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
 * | `NDX_EXTENSION_CONFIG`    | A JSON file holding the extension's config section; a command process's own |
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

import { randomBytes } from "node:crypto";
import * as nodeFs from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_EXTENSION_API_VERSIONS } from "./extension-manifest.js";

/** The contract version n-dx speaks: the newest it supports. */
export const EXTENSION_API_VERSION = Math.max(...SUPPORTED_EXTENSION_API_VERSIONS);

/** Under the n-dx home, one folder per extension name. */
export const EXTENSION_STATE_DIRNAME = "ext";

/**
 * A command process's `NDX_EXTENSION_CONFIG`, in the extension's state folder:
 * `ndx-config-<ndx pid>-<random>.json`, holding the merged `extensions.<name>`
 * section (`loadExtensionConfig` in config.js). One file per process, because
 * runs in different projects merge different sections and may run at once.
 * The caller removes it when the command closes ({@link releaseExtensionConfig});
 * a file whose n-dx process died is swept by the next run.
 */
export const EXTENSION_CONFIG_PREFIX = "ndx-config-";

/**
 * A sidecar's `NDX_EXTENSION_CONFIG`: the user's section only, since a sidecar
 * serves no single project. A file of its own, so a command run never changes
 * the config a running sidecar was started with.
 */
export const SIDECAR_CONFIG_FILENAME = "sidecar-config.json";

/** A command's config file, or a temp file mid-write; group 1 is the writer's pid. */
const COMMAND_CONFIG_FILE = /^ndx-config-(\d+)-[0-9a-f]+\.json$/;
const TEMP_FILE = /\.json\.(\d+)-[0-9a-f]+\.tmp$/;

/** The single shared file earlier versions wrote; removed when seen. */
const LEGACY_CONFIG_FILENAME = "ndx-config.json";

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
 * @typedef {Pick<typeof nodeFs, "existsSync" | "mkdirSync" | "readFileSync" | "readdirSync" | "renameSync" | "rmSync" | "writeFileSync">} ExtensionEnvFs
 */

/**
 * @typedef {object} ExtensionEnvOptions
 * @property {string} name  The manifest `name`.
 * @property {string} home  The resolved n-dx home.
 * @property {string} ndxVersion  The running n-dx.
 * @property {Record<string, unknown>} [config]  The merged config section; defaults to `{}`.
 * @property {boolean} [sidecar]  A sidecar's environment: the config goes to {@link SIDECAR_CONFIG_FILENAME}.
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
 * config file; throws when it cannot, since the contract promises both. The
 * file is written whole and renamed into place, so no reader sees part of it.
 *
 * @param {ExtensionEnvOptions} options
 * @returns {Record<string, string | undefined>}
 */
export function extensionEnvironment(options) {
  const fs = options.fs ?? nodeFs;
  const isAlive = options.isAlive ?? isPidAlive;
  const stateDir = extensionStateDir(options.home, options.name);
  fs.mkdirSync(stateDir, { recursive: true });
  sweepStaleConfigs(stateDir, fs, isAlive);
  const configFile = join(
    stateDir,
    options.sidecar ? SIDECAR_CONFIG_FILENAME : `${EXTENSION_CONFIG_PREFIX}${process.pid}-${randomBytes(6).toString("hex")}.json`,
  );
  writeWhole(fs, configFile, JSON.stringify(options.config ?? {}, null, 2) + "\n");

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

  const hub = runningHub(options.home, fs, isAlive);
  if (hub) {
    env.NDX_HUB_URL = hub.url;
    if (hub.tokenFile) env.NDX_TOKEN_FILE = hub.tokenFile;
  }
  return env;
}

/**
 * Remove a command process's config file once the command has closed. A
 * sidecar's file stays: the sidecar outlives the process that planned it.
 *
 * @param {Record<string, string | undefined>} env  What {@link extensionEnvironment} returned.
 * @param {Pick<ExtensionEnvFs, "rmSync">} [fs]
 */
export function releaseExtensionConfig(env, fs = nodeFs) {
  const file = env.NDX_EXTENSION_CONFIG;
  if (file && COMMAND_CONFIG_FILE.test(basename(file))) fs.rmSync(file, { force: true });
}

/**
 * Write `content` to a sibling temp file and rename it over `file`. A file
 * already holding `content` is left alone, so concurrent plans of one sidecar
 * do not race to replace an identical file.
 *
 * @param {ExtensionEnvFs} fs
 * @param {string} file
 * @param {string} content
 */
function writeWhole(fs, file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf-8") === content) return;
  const tmp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, content);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Remove command config files and temp files whose n-dx process is gone
 * (killed before it could clean up), and the shared file earlier versions wrote.
 *
 * @param {string} stateDir
 * @param {ExtensionEnvFs} fs
 * @param {(pid: number) => boolean} isAlive
 */
function sweepStaleConfigs(stateDir, fs, isAlive) {
  for (const entry of fs.readdirSync(stateDir)) {
    const match = COMMAND_CONFIG_FILE.exec(entry) ?? TEMP_FILE.exec(entry);
    if (entry === LEGACY_CONFIG_FILENAME || (match && !isAlive(Number(match[1])))) {
      fs.rmSync(join(stateDir, entry), { force: true });
    }
  }
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
