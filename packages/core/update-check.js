/**
 * Non-blocking npm registry update check for @n-dx/core.
 *
 * Design goals:
 *  - Never block or delay CLI command execution.
 *  - Cache the result with a 24-hour TTL so the registry is not hit on
 *    every invocation.
 *  - Never throw — all errors are silently swallowed so a network failure
 *    or a broken cache file never crashes the CLI.
 *
 * @module n-dx/update-check
 */

import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGISTRY_URL = "https://registry.npmjs.org/@n-dx/core/latest";

/** Cache TTL: 24 hours. Exported for tests. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const CACHE_FILE = join(tmpdir(), "n-dx-update-check.json");

// ── Cache helpers ─────────────────────────────────────────────────────────────

/** Load cached check result. Returns null if missing, expired, or invalid. */
async function loadCache() {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (!data || typeof data.latestVersion !== "string" || typeof data.checkedAt !== "number") {
      return null;
    }
    if (Date.now() - data.checkedAt > CACHE_TTL_MS) {
      return null; // expired
    }
    return data.latestVersion;
  } catch {
    return null;
  }
}

/** Persist a check result to the cache file. Errors are silently ignored. */
async function saveCache(latestVersion) {
  try {
    await writeFile(
      CACHE_FILE,
      JSON.stringify({ checkedAt: Date.now(), latestVersion }),
      "utf-8",
    );
  } catch {
    // Cache write failure is non-fatal — next invocation will re-fetch.
  }
}

// ── Registry fetch ────────────────────────────────────────────────────────────

/**
 * Fetch the latest published version from the npm registry.
 * Returns null on any error (network failure, timeout, bad response, etc.).
 */
async function fetchLatestVersion() {
  try {
    const controller = new AbortController();
    // 3-second timeout — fast networks finish in < 200 ms; this avoids
    // blocking exit on sluggish or firewalled environments.
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(REGISTRY_URL, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.version === "string" ? data.version : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// ── Version comparison ────────────────────────────────────────────────────────

/**
 * Returns true when `latest` is strictly newer than `current`.
 * Handles standard N.N.N semver; pre-release suffixes are ignored (they are
 * never newer than a release with the same N.N.N prefix).
 */
function isNewer(current, latest) {
  const parse = (v) =>
    v
      .split("-")[0] // strip pre-release suffix
      .split(".")
      .map(Number);
  const [cMaj, cMin, cPat] = parse(current);
  const [lMaj, lMin, lPat] = parse(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start an update check against the npm registry.
 *
 * @param {{ currentVersion?: string|null }} options
 * @returns {Promise<{ current: string, latest: string } | null>}
 *   Resolves with update info when a newer version is available, or null
 *   when the current version is up to date, the check fails, or
 *   `currentVersion` is falsy.
 *
 * This function never rejects.
 */
export async function startUpdateCheck({ currentVersion } = {}) {
  try {
    if (!currentVersion) return null;

    // Check cache before hitting the network.
    let latestVersion = await loadCache();

    if (!latestVersion) {
      latestVersion = await fetchLatestVersion();
      if (latestVersion) {
        await saveCache(latestVersion);
      }
    }

    if (!latestVersion) return null;
    if (!isNewer(currentVersion, latestVersion)) return null;

    return { current: currentVersion, latest: latestVersion };
  } catch {
    return null;
  }
}

/**
 * Format a one-line update notice for display after command output.
 *
 * @param {{ current: string, latest: string }} info
 * @returns {string}
 */
export function formatUpdateNotice({ current, latest }) {
  // Use plain ANSI without importing cli-brand so this module stays
  // self-contained and testable without side-effects.
  const dim = (t) => `\x1b[2m${t}\x1b[22m`;
  const bold = (t) => `\x1b[1m${t}\x1b[22m`;
  const cyan = (t) => `\x1b[36m${t}\x1b[39m`;

  return (
    `\n  ${dim("Update available:")} ${dim(current)} → ${cyan(bold(latest))}` +
    `  ${dim("Run")} ${bold("npm i -g @n-dx/core")} ${dim("to update.")}`
  );
}
