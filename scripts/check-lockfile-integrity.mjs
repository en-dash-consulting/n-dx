#!/usr/bin/env node

/**
 * Supply-chain integrity gate for the lockfile, the registry configuration
 * and install-time scripts.
 *
 * `.npmrc` already carries the two controls that matter most — `ignore-scripts`
 * stops install hooks executing, and `minimum-release-age` keeps freshly
 * published versions out — but both protect against packages fetched *from the
 * registry*. Neither helps if a dependency is resolved from somewhere else
 * entirely. A lockfile entry can name a git URL or an arbitrary tarball, and
 * pnpm will fetch and use it: no release age to wait out, no registry to
 * publish through, and nothing in a diff that looks unusual to a reviewer
 * skimming a 20,000-line file.
 *
 * So this checks the things a PR could change that would quietly move where
 * code comes from, or re-enable running it at install time:
 *
 *   1. Every resolution in pnpm-lock.yaml is a registry resolution.
 *   2. No dependency is specified by git, http(s) or file protocol, and every
 *      `link:` stays inside the repository.
 *   3. `.npmrc` still sets `ignore-scripts=true`, still holds a meaningful
 *      `minimum-release-age`, and still points at the public npm registry.
 *   4. No package.json in the workspace declares an install-time script.
 *
 * Deliberately dependency-free. The root package has no production
 * dependencies at all, and adding a YAML parser to a supply-chain gate would
 * widen the surface the gate exists to protect. The cost is that the lockfile
 * is scanned as text, which is only safe because pnpm generates the file with
 * stable, machine-written shapes — so an unrecognised `lockfileVersion` fails
 * the check rather than scanning a format these patterns were not written for.
 *
 * @see tests/unit/check-lockfile-integrity.test.js
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Lockfile major versions these textual patterns were written against. */
export const SUPPORTED_LOCKFILE_VERSIONS = ["9"];

/** The only registry host a resolution or an .npmrc entry may name. */
export const ALLOWED_REGISTRY = "registry.npmjs.org";

/** Scripts npm/pnpm run as part of installing a package. */
export const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"];

/**
 * Floor for `minimum-release-age`, in minutes. pnpm refuses versions younger
 * than this, which is the window in which a compromised publish is usually
 * caught and unpublished. A day is the floor rather than the current setting
 * so the value stays tunable; the point is that it cannot quietly become a
 * number small enough to mean nothing.
 */
export const MIN_RELEASE_AGE_FLOOR_MINUTES = 1440;

/** Repo-relative and forward-slashed, so a finding reads the same on every OS. */
function displayPath(rootDir, path) {
  return relative(rootDir, path).split("\\").join("/");
}

// ── 1 + 2: the lockfile ─────────────────────────────────────────────────────

function checkLockfile(rootDir, fail) {
  const path = join(rootDir, "pnpm-lock.yaml");
  if (!existsSync(path)) {
    fail("pnpm-lock.yaml", 0, "Lockfile is missing; the install is not reproducible.");
    return;
  }

  const lines = readFileSync(path, "utf-8").split(/\r?\n/);

  const versionLine = lines.find((l) => l.startsWith("lockfileVersion:"));
  const version = versionLine?.match(/lockfileVersion:\s*'?"?([0-9]+)/)?.[1];
  if (!version || !SUPPORTED_LOCKFILE_VERSIONS.includes(version)) {
    // Fail closed. A newer pnpm may spell resolutions differently, and a gate
    // that silently scans a format it does not understand is worse than none.
    fail(
      "pnpm-lock.yaml",
      versionLine ? lines.indexOf(versionLine) + 1 : 0,
      `lockfileVersion ${version ?? "(unreadable)"} is not one this check understands `
        + `(${SUPPORTED_LOCKFILE_VERSIONS.join(", ")}). Re-read the resolution shapes in `
        + "scripts/check-lockfile-integrity.mjs and widen SUPPORTED_LOCKFILE_VERSIONS.",
    );
    return;
  }

  lines.forEach((line, i) => {
    const no = i + 1;

    // A registry resolution is `resolution: {integrity: sha512-...}`. Anything
    // else — `tarball:`, `type: git`, `directory:` — fetches from elsewhere.
    const resolution = line.match(/^\s*resolution:\s*\{(.+)\}\s*$/);
    if (resolution && !/^integrity:/.test(resolution[1].trim())) {
      fail("pnpm-lock.yaml", no, `Non-registry resolution: ${resolution[1].trim()}`);
    }

    // Dependency specs and resolved versions that name a protocol.
    const spec = line.match(/^\s*(?:specifier|version):\s*(\S.*)$/);
    if (spec) {
      const value = spec[1].trim().replace(/^['"]|['"]$/g, "");
      if (/^(git|git\+[a-z]+|https?|file):/i.test(value)) {
        fail("pnpm-lock.yaml", no, `Dependency resolved outside the registry: ${value}`);
      }
      if (value.startsWith("link:")) {
        // Workspace links are how the packages reference each other. One that
        // climbs out of the repository points at whatever sits beside the
        // checkout on the machine that ran the install.
        const target = resolve(rootDir, "packages", value.slice("link:".length));
        if (relative(rootDir, target).startsWith("..")) {
          fail("pnpm-lock.yaml", no, `Workspace link escapes the repository: ${value}`);
        }
      }
    }

    // An explicit host anywhere in the lockfile.
    const host = line.match(/https?:\/\/([^/\s'"]+)/);
    if (host && host[1] !== ALLOWED_REGISTRY) {
      fail("pnpm-lock.yaml", no, `References a non-npm host: ${host[1]}`);
    }
  });
}

// ── 3: the registry configuration ───────────────────────────────────────────

function checkNpmrc(rootDir, fail) {
  const path = join(rootDir, ".npmrc");
  if (!existsSync(path)) {
    fail(".npmrc", 0, "Missing; ignore-scripts and minimum-release-age are not in force.");
    return;
  }

  const lines = readFileSync(path, "utf-8").split(/\r?\n/);
  const settings = new Map();

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    settings.set(key, value);

    // `registry=` and `@scope:registry=` both redirect where packages come from.
    if (key === "registry" || key.endsWith(":registry")) {
      const host = value.match(/^https?:\/\/([^/\s]+)/)?.[1];
      if (host !== ALLOWED_REGISTRY) {
        fail(".npmrc", i + 1, `Registry is not ${ALLOWED_REGISTRY}: ${value}`);
      }
    }
  });

  if (settings.get("ignore-scripts") !== "true") {
    fail(
      ".npmrc",
      0,
      "ignore-scripts must stay true. Without it a dependency's install hook executes on every `pnpm install`.",
    );
  }

  const releaseAge = settings.get("minimum-release-age");
  const minutes = releaseAge === undefined ? NaN : Number(releaseAge);
  if (!Number.isFinite(minutes) || minutes < MIN_RELEASE_AGE_FLOOR_MINUTES) {
    fail(
      ".npmrc",
      0,
      `minimum-release-age must be at least ${MIN_RELEASE_AGE_FLOOR_MINUTES} minutes `
        + `(found ${releaseAge ?? "nothing"}). It is what keeps a version published minutes ago `
        + "out of an install, which is the shape most registry compromises take.",
    );
  }
}

// ── 4: install-time scripts in this workspace ───────────────────────────────

function packageJsonPaths(rootDir) {
  const found = [];
  const rootPkg = join(rootDir, "package.json");
  if (existsSync(rootPkg)) found.push(rootPkg);

  const packagesDir = join(rootDir, "packages");
  if (!existsSync(packagesDir)) return found;
  for (const entry of readdirSync(packagesDir)) {
    const path = join(packagesDir, entry, "package.json");
    if (existsSync(path) && statSync(path).isFile()) found.push(path);
  }
  return found;
}

function checkInstallScripts(rootDir, fail) {
  for (const path of packageJsonPaths(rootDir)) {
    let scripts;
    try {
      scripts = JSON.parse(readFileSync(path, "utf-8")).scripts ?? {};
    } catch (err) {
      fail(displayPath(rootDir, path), 0, `Unreadable package.json: ${err.message}`);
      continue;
    }
    for (const name of INSTALL_SCRIPTS) {
      if (scripts[name]) {
        fail(
          displayPath(rootDir, path),
          0,
          `Declares a "${name}" script, which runs when the published package is installed. `
            + "Compilation belongs in `prepare`, which runs on publish rather than on install.",
        );
      }
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Every supply-chain finding for a workspace root.
 *
 * @param {string} rootDir Workspace root holding pnpm-lock.yaml and .npmrc.
 * @returns {{ file: string, line: number, message: string }[]} Empty when clean.
 */
export function findSupplyChainIssues(rootDir) {
  const findings = [];
  const fail = (file, line, message) => findings.push({ file, line, message });
  checkLockfile(rootDir, fail);
  checkNpmrc(rootDir, fail);
  checkInstallScripts(rootDir, fail);
  return findings;
}

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
  const findings = findSupplyChainIssues(rootDir);
  if (findings.length === 0) {
    console.log(
      "✓ supply chain: registry-only resolutions, npm registry, "
      + "ignore-scripts and minimum-release-age in force, no install scripts",
    );
  } else {
    console.error(`✗ supply chain: ${findings.length} finding(s)\n`);
    for (const f of findings) {
      console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}\n    ${f.message}\n`);
    }
    console.error(
      "Each of these changes where code comes from or when it runs. If one is intended,\n"
      + "say so in the PR description and get a review from a code owner of .npmrc.\n",
    );
    process.exit(1);
  }
}
