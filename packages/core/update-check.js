/**
 * Auto-update detection — checks npm registry for newer @n-dx/core versions.
 *
 * Non-blocking: the registry fetch runs in the background during command
 * execution.  The result is captured via a `.then()` callback and checked
 * synchronously after the command completes — zero additional delay.
 *
 * Cached: results are stored in ~/.n-dx-update-check.json with a 24-hour TTL
 * so the registry is contacted at most once per day per machine.
 *
 * Silent: all errors are swallowed — network failures, parse errors, and
 * file-system issues never surface to users.
 *
 * @module n-dx/update-check
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Default cache location — global across projects, per machine. */
const DEFAULT_CACHE_PATH = join(homedir(), ".n-dx-update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 2000; // 2 seconds
const REGISTRY_URL = "https://registry.npmjs.org/@n-dx/core/latest";

// ── Exports (for testing) ─────────────────────────────────────────────────────

export { DEFAULT_CACHE_PATH, CACHE_TTL_MS, FETCH_TIMEOUT_MS, REGISTRY_URL };

// ── Cache ─────────────────────────────────────────────────────────────────────

/**
 * Load cached update check result.
 * @returns {{ lastChecked: number, latestVersion: string } | null}
 */
export function loadUpdateCache(cachePath = DEFAULT_CACHE_PATH) {
  try {
    const raw = readFileSync(cachePath, "utf-8");
    const data = JSON.parse(raw);
    if (typeof data.lastChecked === "number" && typeof data.latestVersion === "string") {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save update check result to cache file.
 */
export function saveUpdateCache(latestVersion, cachePath = DEFAULT_CACHE_PATH) {
  try {
    const payload = JSON.stringify({ lastChecked: Date.now(), latestVersion }, null, 2) + "\n";
    writeFileSync(cachePath, payload, "utf-8");
  } catch {
    // Silently ignore write failures (read-only home dir, permissions, etc.)
  }
}

// ── Version comparison ────────────────────────────────────────────────────────

/**
 * Returns true when `latest` is a higher semver than `current`.
 * Only compares major.minor.patch — pre-release labels are ignored.
 */
export function isNewerVersion(latest, current) {
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

// ── Registry fetch ────────────────────────────────────────────────────────────

/**
 * Fetch the latest version of @n-dx/core from the npm registry.
 * Uses a 2-second timeout to avoid holding the process open.
 * @returns {Promise<string | null>} Version string, or null on any failure.
 */
export async function fetchLatestVersion(registryUrl = REGISTRY_URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  // Don't keep the process alive solely for this timer
  if (typeof timeout === "object" && typeof timeout.unref === "function") {
    timeout.unref();
  }
  try {
    const res = await fetch(registryUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main check ────────────────────────────────────────────────────────────────

/**
 * Check for available updates. Returns an update descriptor when a newer
 * version exists, or null otherwise.
 *
 * The function reads a local cache file first. When the cache is fresh
 * (< 24 hours), no network request is made.
 *
 * @param {string} currentVersion  The running @n-dx/core version.
 * @param {object} [opts]
 * @param {string} [opts.cachePath]    Override cache file location (for tests).
 * @param {string} [opts.registryUrl]  Override registry URL (for tests).
 * @returns {Promise<{ updateAvailable: true, latestVersion: string, currentVersion: string } | null>}
 */
export async function checkForUpdate(currentVersion, {
  cachePath = DEFAULT_CACHE_PATH,
  registryUrl = REGISTRY_URL,
} = {}) {
  // Check cache first — avoids network when fresh
  const cache = loadUpdateCache(cachePath);
  if (cache && (Date.now() - cache.lastChecked) < CACHE_TTL_MS) {
    if (isNewerVersion(cache.latestVersion, currentVersion)) {
      return { updateAvailable: true, latestVersion: cache.latestVersion, currentVersion };
    }
    return null;
  }

  // Cache stale or missing — fetch from registry
  const latestVersion = await fetchLatestVersion(registryUrl);
  if (!latestVersion) return null;

  saveUpdateCache(latestVersion, cachePath);

  if (isNewerVersion(latestVersion, currentVersion)) {
    return { updateAvailable: true, latestVersion, currentVersion };
  }
  return null;
}

// ── Display ───────────────────────────────────────────────────────────────────

/**
 * Format the update notice as a single non-intrusive line.
 * Returns plain text — the caller applies ANSI styling (e.g. dim()).
 */
export function formatUpdateNotice(latestVersion, currentVersion) {
  return `Update available: ${currentVersion} \u2192 ${latestVersion} \u2014 run \`npm install -g @n-dx/core\` to update`;
}

// ── Suppression ───────────────────────────────────────────────────────────────

/**
 * Determine whether the update notice should be suppressed.
 *
 * Suppressed when:
 * - The command exited with an error (user has bigger problems)
 * - stdout is not a TTY (piped / CI / non-interactive)
 * - --quiet / -q was passed
 * - JSON output mode (--json, --format=json) — avoid polluting machine output
 *
 * @param {string[]} args  CLI arguments (process.argv.slice(2)).
 * @param {number}   exitCode  The command's exit code.
 * @returns {boolean}
 */
export function shouldSuppressNotice(args, exitCode) {
  if (exitCode !== 0) return true;
  if (!process.stdout.isTTY) return true;
  if (args.includes("--quiet") || args.includes("-q")) return true;
  if (args.includes("--json")) return true;
  if (args.some((a) => a === "--format=json")) return true;
  return false;
}
