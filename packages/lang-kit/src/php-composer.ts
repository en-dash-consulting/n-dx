/**
 * Composer metadata, read as text: each `composer.json` in the inventory and
 * the `composer.lock` beside it. Composer is never run and nothing is
 * installed. Held in memory only; a lock file's versions are never persisted.
 *
 * Every `composer.json` is its own project (a monorepo's path repositories
 * included), except one inside another project's vendor directory. Malformed
 * input becomes a notice and an empty model; nothing throws on file content.
 *
 * @module lang-kit/php-composer
 */

import { join, posix } from "node:path";
import { MAX_BUILD_FILE_BYTES, type OversizedBuildFile, oversizedNotice, readBuildFile } from "./build-file.js";

/** One namespace prefix (`App\\`, `Zend_`, or `""` for the fallback) and its directories. */
export interface ComposerNamespaceMapping {
  /** As written. */
  readonly prefix: string;
  /** In declared order; see {@link ComposerAutoload} for what they are relative to. */
  readonly paths: readonly string[];
}

/**
 * An `autoload` or `autoload-dev` block. Mappings and lists keep their
 * declared order. Paths are POSIX and normalised (`./src/` is `src`, the base
 * itself is `""`); one leaving the base starts with `../`. In a project they
 * are repository-relative; in a lock package, relative to the package root.
 */
export interface ComposerAutoload {
  readonly psr4: readonly ComposerNamespaceMapping[];
  readonly psr0: readonly ComposerNamespaceMapping[];
  readonly classmap: readonly string[];
  readonly files: readonly string[];
  readonly excludeFromClassmap: readonly string[];
}

/** A `require` or `require-dev` entry, name and constraint as written. */
export interface ComposerRequirement {
  readonly name: string;
  readonly constraint: string;
  readonly dev: boolean;
  /** A name without a `vendor/` part: PHP itself, an extension (`ext-*`) or a library (`lib-*`), never a package. */
  readonly platform?: true;
}

/** A `repositories` entry with a string `type` and `url`, both as written (`path`, `vcs`, …). */
export interface ComposerRepository {
  readonly type: string;
  readonly url: string;
}

/** A package in `composer.lock` (`packages`, or `packages-dev` when `dev`). */
export interface ComposerLockPackage {
  readonly name: string;
  /** In memory only, never persisted. */
  readonly version?: string;
  readonly dev: boolean;
  /** Paths relative to the package root. */
  readonly autoload: ComposerAutoload;
}

export interface ComposerProject {
  /** The manifest's directory, relative to the repository root, POSIX; "" is the root. */
  readonly dir: string;
  readonly name?: string;
  /** `composer.json` and, when read, `composer.lock`; repository-relative, sorted. */
  readonly files: readonly string[];
  /** `require` then `require-dev`, each in declared order. */
  readonly requirements: readonly ComposerRequirement[];
  readonly autoload: ComposerAutoload;
  readonly autoloadDev: ComposerAutoload;
  readonly repositories: readonly ComposerRepository[];
  /** `config.vendor-dir`, or Composer's default `vendor`; repository-relative. */
  readonly vendorDir: string;
  /** The lock file's packages, `packages` then `packages-dev`, sorted by name; absent without a readable lock. */
  readonly lockPackages?: readonly ComposerLockPackage[];
  readonly notices: readonly string[];
}

/** Repository text by repository-relative path; `undefined` when unreadable. */
export type ReadComposerText = (path: string) => Promise<string | OversizedBuildFile | undefined>;

/**
 * The cap for `composer.lock`: a lock lists every installed package with its
 * metadata, so it outgrows other build files (koel's is about 605 KB).
 */
export const MAX_COMPOSER_LOCK_BYTES = 16 * 1024 * 1024;

const MANIFEST = "composer.json";
const LOCK = "composer.lock";
const DEFAULT_VENDOR_DIR = "vendor";

/** The size cap a Composer file is read with: the lock's own, every other file the build file cap. */
function capOf(path: string): number {
  return posix.basename(path) === LOCK ? MAX_COMPOSER_LOCK_BYTES : MAX_BUILD_FILE_BYTES;
}

const EMPTY_AUTOLOAD: ComposerAutoload = { psr4: [], psr0: [], classmap: [], files: [], excludeFromClassmap: [] };

/**
 * Read the Composer projects of a repository. `files` is the inventory
 * (repository-relative, POSIX); manifests and lock files are found in it,
 * never on the disk. Sorted by directory.
 */
export async function readComposerProjects(projectDir: string, files: readonly string[]): Promise<ComposerProject[]> {
  return composerProjectsFrom(files, async (path) => {
    try {
      return await readBuildFile(join(projectDir, path), capOf(path));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES" || code === "EISDIR" || code === "EPERM") return undefined;
      throw err;
    }
  });
}

/** {@link readComposerProjects} over any reader; tests pass an in-memory one. */
export async function composerProjectsFrom(files: readonly string[], read: ReadComposerText): Promise<ComposerProject[]> {
  const inventory = new Set(files);
  const dirs = files.filter((f) => posix.basename(f) === MANIFEST).map(dirOf).sort();
  const projects: ComposerProject[] = [];
  for (const dir of dirs) projects.push(await readProject(dir, inventory, read));
  // A manifest inside another project's vendor directory is an installed package, not a project.
  const vendorDirs = projects.map((p) => p.vendorDir);
  return projects.filter((p) => !vendorDirs.some((v) => isInside(p.dir, v)));
}

async function readProject(dir: string, inventory: ReadonlySet<string>, read: ReadComposerText): Promise<ComposerProject> {
  const at = (name: string): string => (dir === "" ? name : `${dir}/${name}`);
  const notices: string[] = [];
  const readFiles: string[] = [];

  const manifestFile = at(MANIFEST);
  const manifest = parseObject(manifestFile, await read(manifestFile), notices);
  if (manifest) readFiles.push(manifestFile);
  const m = manifest ?? {};
  const field = fieldReader(manifestFile, notices);

  const name = field.string(m, "name");
  const requirements = [...readRequirements(field.object(m, "require"), false), ...readRequirements(field.object(m, "require-dev"), true)];
  const autoload = readAutoload(field.object(m, "autoload"), dir, field, "autoload");
  const autoloadDev = readAutoload(field.object(m, "autoload-dev"), dir, field, "autoload-dev");
  const repositories = readRepositories(m["repositories"], manifestFile, notices);
  const config = field.object(m, "config");
  const vendorDirWritten = config && field.string(config, "vendor-dir", "config.vendor-dir");
  const vendorDir = normalize(dir, vendorDirWritten ?? DEFAULT_VENDOR_DIR);

  let lockPackages: ComposerLockPackage[] | undefined;
  const lockFile = at(LOCK);
  if (inventory.has(lockFile)) {
    const lock = parseObject(lockFile, await read(lockFile), notices);
    if (lock) {
      readFiles.push(lockFile);
      lockPackages = readLockPackages(lock, lockFile, notices);
    }
  }

  return {
    dir,
    ...(name !== undefined && { name }),
    files: readFiles.sort(),
    requirements,
    autoload,
    autoloadDev,
    repositories,
    vendorDir,
    ...(lockPackages && { lockPackages }),
    notices,
  };
}

// ── JSON ─────────────────────────────────────────────────────────────────

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The file's top-level object, or `undefined` with a notice. */
function parseObject(file: string, text: string | OversizedBuildFile | undefined, notices: string[]): JsonObject | undefined {
  if (text === undefined) {
    notices.push(`${file} is unreadable`);
    return undefined;
  }
  if (typeof text !== "string") {
    notices.push(oversizedNotice(file, text.oversized, capOf(file)));
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    notices.push(`${file}: not read: ${err.message}`);
    return undefined;
  }
  if (!isObject(value)) {
    notices.push(`${file}: not read: the top level is not an object`);
    return undefined;
  }
  return value;
}

/** Typed field access that records a notice for a field of the wrong type. */
function fieldReader(file: string, notices: string[]) {
  const wrong = (label: string, kind: string): void => {
    notices.push(`${file}: ${label} is not ${kind}`);
  };
  return {
    string(obj: JsonObject, key: string, label = key): string | undefined {
      const v = obj[key];
      if (v === undefined) return undefined;
      if (typeof v === "string") return v;
      wrong(label, "a string");
      return undefined;
    },
    object(obj: JsonObject, key: string, label = key): JsonObject | undefined {
      const v = obj[key];
      if (v === undefined) return undefined;
      if (isObject(v)) return v;
      wrong(label, "an object");
      return undefined;
    },
    /** A string or an array of strings (non-strings dropped with a notice). */
    strings(value: unknown, label: string): string[] {
      if (typeof value === "string") return [value];
      if (!Array.isArray(value)) {
        wrong(label, "a string or an array of strings");
        return [];
      }
      const out = value.filter((v): v is string => typeof v === "string");
      if (out.length !== value.length) wrong(`every entry of ${label}`, "a string");
      return out;
    },
  };
}

type FieldReader = ReturnType<typeof fieldReader>;

// ── composer.json ────────────────────────────────────────────────────────

function readRequirements(block: JsonObject | undefined, dev: boolean): ComposerRequirement[] {
  if (!block) return [];
  const out: ComposerRequirement[] = [];
  for (const [name, constraint] of Object.entries(block)) {
    if (typeof constraint !== "string") continue;
    out.push({ name, constraint, dev, ...(!name.includes("/") && { platform: true as const }) });
  }
  return out;
}

function readAutoload(block: JsonObject | undefined, base: string, field: FieldReader, label: string): ComposerAutoload {
  if (!block) return EMPTY_AUTOLOAD;
  const mappings = (key: string): ComposerNamespaceMapping[] => {
    const obj = field.object(block, key, `${label}.${key}`);
    if (!obj) return [];
    return Object.entries(obj).map(([prefix, paths]) => ({
      prefix,
      paths: field.strings(paths, `${label}.${key}["${prefix}"]`).map((p) => normalize(base, p)),
    }));
  };
  const list = (key: string): string[] =>
    block[key] === undefined ? [] : field.strings(block[key], `${label}.${key}`).map((p) => normalize(base, p));
  return {
    psr4: mappings("psr-4"),
    psr0: mappings("psr-0"),
    classmap: list("classmap"),
    files: list("files"),
    excludeFromClassmap: list("exclude-from-classmap"),
  };
}

function readRepositories(value: unknown, file: string, notices: string[]): ComposerRepository[] {
  if (value === undefined) return [];
  // An array of repositories, or an object keyed by name (`{"packagist.org": false}` disables one).
  const entries = Array.isArray(value) ? value : isObject(value) ? Object.values(value) : undefined;
  if (!entries) {
    notices.push(`${file}: repositories is not an array or an object`);
    return [];
  }
  const out: ComposerRepository[] = [];
  for (const entry of entries) {
    if (isObject(entry) && typeof entry["type"] === "string" && typeof entry["url"] === "string") {
      out.push({ type: entry["type"], url: entry["url"] });
    }
  }
  return out;
}

// ── composer.lock ────────────────────────────────────────────────────────

function readLockPackages(lock: JsonObject, file: string, notices: string[]): ComposerLockPackage[] {
  const field = fieldReader(file, notices);
  const out: ComposerLockPackage[] = [];
  for (const [key, dev] of [["packages", false], ["packages-dev", true]] as const) {
    const list = lock[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      notices.push(`${file}: ${key} is not an array`);
      continue;
    }
    list.forEach((pkg, i) => {
      if (!isObject(pkg) || typeof pkg["name"] !== "string") {
        notices.push(`${file}: ${key}[${i}] has no name`);
        return;
      }
      const version = typeof pkg["version"] === "string" ? pkg["version"] : undefined;
      const autoload = readAutoload(field.object(pkg, "autoload", `${key}[${i}].autoload`), "", field, `${key}[${i}].autoload`);
      out.push({ name: pkg["name"], ...(version !== undefined && { version }), dev, autoload });
    });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ── paths ────────────────────────────────────────────────────────────────

function dirOf(file: string): string {
  const d = posix.dirname(file);
  return d === "." ? "" : d;
}

/** `path` (as written, relative to `base`) as a normalised POSIX path; `""` is `base` at the root. */
function normalize(base: string, path: string): string {
  const joined = posix.normalize(posix.join(base, path.replace(/\\/g, "/")));
  const trimmed = joined.replace(/\/+$/, "");
  return trimmed === "." || trimmed === "" ? "" : trimmed;
}

function isInside(dir: string, ancestor: string): boolean {
  if (ancestor === "" || ancestor.startsWith("../")) return false;
  return dir === ancestor || dir.startsWith(`${ancestor}/`);
}
