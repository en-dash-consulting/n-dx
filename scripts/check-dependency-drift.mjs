#!/usr/bin/env node

/**
 * Dependency-drift check — catch a stale node_modules before it lies to you.
 *
 * Walks the root and every packages/* package.json, and reports each declared
 * dependency whose INSTALLED version does not satisfy the declared range.
 * Runs in front of `pnpm typecheck` (and standalone as `pnpm deps:check`).
 *
 * Why: a tree whose node_modules predates a dependency bump produces errors
 * that look exactly like real defects. Observed 2026-08-24 — typescript
 * resolved to 5.9.3 against a declared ^6.0.3, and `pnpm typecheck` failed a
 * correct test on a `lib.dom.d.ts` type that 5.9 did not know about, while CI
 * (fresh install) was green on the identical commit. The wrong conclusion —
 * "fix" the correct test — was recommended before the stale install was found.
 *
 * Deliberately conservative: ranges the checker does not understand
 * (workspace:, npm:, file:, git URLs, ||-unions it cannot parse) are skipped,
 * and a dependency with no installed copy is skipped too — a fresh clone is
 * not drift, and a false positive here would train people to ignore the check.
 *
 * The fix for reported drift is always the same: `pnpm install`.
 */

import { readFile, readdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Range prefixes that are not version ranges at all — never checked. */
const SKIP_PREFIXES = ["workspace:", "npm:", "file:", "link:", "portal:", "catalog:", "git", "http"];

/**
 * Find every workspace dependency whose installed version fails its range.
 *
 * @param {string} rootDir - Monorepo root (contains package.json and packages/).
 * @returns {Promise<Array<{package: string, dependency: string, declared: string, installed: string, dir: string}>>}
 */
export async function findDependencyDrift(rootDir) {
  const drift = [];

  for (const pkgDir of await workspaceDirs(rootDir)) {
    const manifest = await readJson(join(pkgDir, "package.json"));
    if (!manifest) continue;
    const owner = typeof manifest.name === "string" ? manifest.name : pkgDir;

    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    };

    for (const [dependency, range] of Object.entries(declared)) {
      if (typeof range !== "string" || !isCheckableRange(range)) continue;

      const installed = await installedVersion(rootDir, pkgDir, dependency);
      if (!installed) continue; // not installed at all — a fresh clone, not drift

      if (!satisfies(installed, range)) {
        drift.push({ package: owner, dependency, declared: range, installed, dir: pkgDir });
      }
    }
  }

  return drift;
}

/** The root plus every direct child of packages/ that has a package.json. */
async function workspaceDirs(rootDir) {
  const dirs = [rootDir];
  try {
    const entries = await readdir(join(rootDir, "packages"), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        dirs.push(join(rootDir, "packages", entry.name));
      }
    }
  } catch {
    // No packages/ directory — a single-package fixture is fine.
  }
  return dirs;
}

/**
 * The version node would resolve for `dependency` from `pkgDir`: the
 * package-local node_modules first, then the hoisted root copy.
 */
async function installedVersion(rootDir, pkgDir, dependency) {
  for (const base of [pkgDir, rootDir]) {
    const manifest = await readJson(join(base, "node_modules", ...dependency.split("/"), "package.json"));
    if (manifest && typeof manifest.version === "string") return manifest.version;
  }
  return null;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

// ── Minimal semver, on purpose ────────────────────────────────────────
// The checker must not itself depend on a correctly-installed tree, so it
// implements only the range forms this repo uses (^, ~, exact, >=-style
// comparators, x-ranges, ||-unions) and SKIPS anything else. Skipping an
// exotic range costs one uncovered dependency; mis-judging one would cost
// the check its credibility.

function isCheckableRange(range) {
  const r = range.trim();
  if (!r || r === "*" || r === "latest") return false;
  return !SKIP_PREFIXES.some((prefix) => r.startsWith(prefix));
}

/** Parse "1.2.3" (with optional prerelease, ignored) → [1,2,3], or null. */
function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Does `version` satisfy `range`? Unparseable input satisfies by fiat. */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return true;
  return range.split("||").some((part) => {
    const comparators = part.trim().split(/\s+/).filter(Boolean);
    if (comparators.length === 0) return true;
    return comparators.every((c) => satisfiesComparator(v, c));
  });
}

function satisfiesComparator(v, comparator) {
  const opMatch = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(comparator);
  const op = opMatch[1] ?? "";
  const rest = opMatch[2];

  // x-ranges: "6", "6.x", "6.0.x" — match on the specified positions.
  const xMatch = /^v?(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/.exec(rest);
  const base = parseVersion(rest) ?? (xMatch ? padXRange(xMatch) : null);
  if (!base) return true; // not a comparator we understand — skip

  switch (op) {
    case "^": {
      // >= base, < next breaking version (major, or minor when major is 0)
      if (compare(v, base) < 0) return false;
      if (base[0] > 0) return v[0] === base[0];
      if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
      return v[0] === 0 && v[1] === 0 && v[2] === base[2];
    }
    case "~":
      return compare(v, base) >= 0 && v[0] === base[0] && v[1] === base[1];
    case ">=":
      return compare(v, base) >= 0;
    case "<=":
      return compare(v, base) <= 0;
    case ">":
      return compare(v, base) > 0;
    case "<":
      return compare(v, base) < 0;
    default: {
      // Bare version: exact when fully specified, prefix-match on an x-range.
      if (xMatch && (xMatch[2] === undefined || /[xX*]/.test(xMatch[2] ?? "") || /[xX*]/.test(xMatch[3] ?? ""))) {
        if (v[0] !== base[0]) return false;
        const minorSpecified = xMatch[2] !== undefined && !/[xX*]/.test(xMatch[2]);
        return !minorSpecified || v[1] === base[1];
      }
      return compare(v, base) === 0;
    }
  }
}

function padXRange(xMatch) {
  const num = (s) => (s === undefined || /[xX*]/.test(s) ? 0 : Number(s));
  return [Number(xMatch[1]), num(xMatch[2]), num(xMatch[3])];
}

// ── CLI entry ─────────────────────────────────────────────────────────

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const rootDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const drift = await findDependencyDrift(rootDir);
  if (drift.length > 0) {
    console.error("Dependency drift: node_modules does not match the declared ranges.");
    console.error("Errors from a stale install look exactly like real defects (e.g. typecheck");
    console.error("failures CI does not have). Run `pnpm install` before trusting a red result.\n");
    for (const d of drift) {
      console.error(`  ${d.package}: ${d.dependency} installed ${d.installed}, declared ${d.declared}`);
    }
    process.exit(1);
  }
}
