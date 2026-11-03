/** Ask the installed hench CLI for the shared trust classifier; core never imports its library. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSyncCli } from "./win-spawn.js";

const require = createRequire(import.meta.url);

/**
 * `trust status --format=json` lists every finding and inventory entry, so a
 * large repository can print well past Node's 1 MB default; an overflow is the
 * classifier failing, not git.
 */
const STATUS_MAX_BUFFER = 64 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 15_000;

/** The hench CLI core spawns for the classifier. */
function henchCliPath() {
  try { return require.resolve("@n-dx/hench/dist/cli/index.js"); }
  catch { return fileURLToPath(new URL("../hench/dist/cli/index.js", import.meta.url)); }
}

/** One line saying why the hench CLI gave no classification. */
function classifierFailure(err) {
  if (err?.code === "ENOBUFS") return "hench trust status printed more than core reads";
  if (err?.code === "ETIMEDOUT" || err?.signal === "SIGTERM") return `hench trust status did not answer within ${STATUS_TIMEOUT_MS / 1000} s`;
  const stderrLine = String(err?.stderr ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  return stderrLine ?? (err?.message ? String(err.message).split(/\r?\n/)[0] : "hench trust status failed");
}

/**
 * Fail closed when classification cannot answer. Paths are git's spelling,
 * including case variants and symlink targets, never the configured binary.
 *
 * Two different failures both count the file as tracked, and are kept apart so
 * a caller can tell the user the fix that applies: `unanswered` is git's (the
 * classifier ran, git could not say — `safe.directory`, a corrupt index), and
 * `classifierError` is the classifier's own (hench not built, its timeout, its
 * output unreadable), which no git setting changes.
 *
 * @param {string} root
 * @param {{ cli?: string }} [options]  `cli`: the hench entry point to spawn (tests).
 * @returns {{ tracked: boolean, paths: string[], unanswered: boolean, nestedIn: string|null, classifierError: string|null }}
 */
export function localConfigStatus(root, options = {}) {
  let output;
  try {
    const cli = options.cli ?? henchCliPath();
    output = execFileSyncCli(process.execPath, [cli, "trust", "status", "--format=json", root], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: STATUS_TIMEOUT_MS, maxBuffer: STATUS_MAX_BUFFER,
    });
  } catch (err) {
    return unclassified(classifierFailure(err));
  }
  let config;
  try { config = JSON.parse(String(output))?.config; }
  catch { return unclassified("hench trust status printed no readable JSON"); }
  if (typeof config?.localConfigTracked !== "boolean") return unclassified("hench trust status gave no local-config classification");
  return {
    tracked: config.localConfigTracked,
    paths: Array.isArray(config.localConfigTrackedPaths) ? config.localConfigTrackedPaths.filter((p) => typeof p === "string") : [],
    unanswered: Boolean(config.localConfigUnanswered),
    nestedIn: typeof config.localConfigNestedIn === "string" ? config.localConfigNestedIn : null,
    classifierError: null,
  };
}

/** Counted as tracked, because nothing said otherwise; `reason` is the classifier's failure. */
function unclassified(reason) {
  return { tracked: true, paths: [], unanswered: false, nestedIn: null, classifierError: reason };
}
