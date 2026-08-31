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
import { fileURLToPath } from "node:url";

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
 * Returns null on any error (network failure, timeout, abort, bad response).
 *
 * @param {AbortSignal} [signal] Caller's cancellation signal, combined with the
 *   internal timeout. The caller uses this to tear the request down when it has
 *   stopped waiting for the answer — see `startUpdateCheck`.
 */
async function fetchLatestVersion(signal) {
  try {
    // 3-second cap — fast networks finish in < 200 ms; this avoids hanging on
    // sluggish or firewalled environments. AbortSignal.timeout's timer is
    // unref'd, so unlike a manual setTimeout it cannot itself hold the loop
    // open, and there is nothing to clear on the success path.
    const timeout = AbortSignal.timeout(3000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const res = await fetch(REGISTRY_URL, { signal: combined });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.version === "string" ? data.version : null;
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

// ── Install-manager detection ─────────────────────────────────────────────────

/**
 * Infer which package manager installed the running copy of @n-dx/core by
 * inspecting its own path on disk.
 *
 * Why this matters: telling a pnpm-global user to run `npm i -g` creates a
 * SECOND global install under the npm prefix. Both ship an `ndx` shim, and
 * whichever lands earlier on PATH wins — so the user can "successfully
 * upgrade" and still be running the old copy, with no error to explain it.
 *
 * Signals (checked in order):
 *  - pnpm always materializes packages inside a `.pnpm` virtual store, and its
 *    global root lives under a `pnpm/` directory. Either segment is conclusive.
 *  - yarn classic installs globals under a `yarn/` data directory.
 *  - anything else (including npm's prefix and a local dev checkout) → npm.
 *
 * @param {string} [modulePath] Absolute path to a file inside the install.
 *   Defaults to this module. Injectable for tests.
 * @returns {"pnpm"|"yarn"|"npm"}
 */
export function detectInstallManager(modulePath = fileURLToPath(import.meta.url)) {
  // Normalize Windows separators so one set of segment checks covers both
  // platforms; lowercase because Windows paths are case-insensitive.
  const path = modulePath.replace(/\\/g, "/").toLowerCase();
  if (path.includes("/.pnpm/") || path.includes("/pnpm/")) return "pnpm";
  if (path.includes("/yarn/")) return "yarn";
  return "npm";
}

/**
 * Build the upgrade command for a given package manager.
 *
 * The explicit `@latest` tag is load-bearing, not decorative. pnpm records a
 * caret range in its global manifest (e.g. `"@n-dx/core": "^0.3.1"`), and for
 * 0.x versions `^0.3.1` means `>=0.3.1 <0.4.0`. A bare `pnpm add -g @n-dx/core`
 * or `pnpm update -g` re-resolves inside that range and can never cross a minor
 * boundary, so the user stays stranded on the old line no matter how many times
 * they "upgrade". `@latest` pins past it.
 *
 * @param {"pnpm"|"yarn"|"npm"} [manager]
 * @returns {string}
 */
export function formatUpgradeCommand(manager = detectInstallManager()) {
  if (manager === "pnpm") return "pnpm add -g @n-dx/core@latest";
  if (manager === "yarn") return "yarn global add @n-dx/core@latest";
  return "npm i -g @n-dx/core@latest";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start an update check against the npm registry.
 *
 * @param {{ currentVersion?: string|null, signal?: AbortSignal }} options
 * @returns {Promise<{ current: string, latest: string } | null>}
 *   Resolves with update info when a newer version is available, or null
 *   when the current version is up to date, the check fails, is cancelled, or
 *   `currentVersion` is falsy.
 *
 * ## Cancellation
 *
 * `signal` exists because the caller exits on a deadline this check may miss.
 * Ignoring a late answer is not enough: an abandoned `fetch` leaves a socket —
 * and, before it, a DNS lookup on libuv's threadpool — outstanding while
 * `process.exit()` tears the event loop down. The completing worker then calls
 * `uv_async_send` on an already-closing handle, and the process aborts with
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` instead of exiting.
 * Cancelling lets the request unwind so the caller can await this promise and
 * exit with nothing in flight.
 *
 * This function never rejects.
 */
export async function startUpdateCheck({ currentVersion, signal } = {}) {
  try {
    if (!currentVersion) return null;

    // Check cache before hitting the network.
    let latestVersion = await loadCache();

    if (!latestVersion) {
      latestVersion = await fetchLatestVersion(signal);
      // A cancelled check must not write the cache: the caller is exiting, and
      // the write is one more piece of threadpool work in the teardown window.
      if (latestVersion && !signal?.aborted) {
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
 * The suggested command is matched to the package manager that actually
 * installed this copy — see `detectInstallManager` for why a hardcoded
 * `npm i -g` silently breaks pnpm and yarn users.
 *
 * @param {{ current: string, latest: string, manager?: "pnpm"|"yarn"|"npm" }} info
 * @returns {string}
 */
export function formatUpdateNotice({ current, latest, manager }) {
  // Use plain ANSI without importing cli-brand so this module stays
  // self-contained and testable without side-effects.
  const dim = (t) => `\x1b[2m${t}\x1b[22m`;
  const bold = (t) => `\x1b[1m${t}\x1b[22m`;
  const cyan = (t) => `\x1b[36m${t}\x1b[39m`;

  const command = formatUpgradeCommand(manager ?? detectInstallManager());

  return (
    `\n  ${dim("Update available:")} ${dim(current)} → ${cyan(bold(latest))}` +
    `  ${dim("Run")} ${bold(command)} ${dim("to update.")}`
  );
}
