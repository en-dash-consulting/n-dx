/**
 * Gradle version catalogs: `gradle/<name>.versions.toml`, read exactly as
 * data (never through Gradle). Build scripts reach them as `<name>.x.y`
 * accessors (`libs.spring.boot.starter`, `libs.plugins.x`, `libs.bundles.x`,
 * `libs.versions.x`); {@link resolveCatalogRef} follows those.
 *
 * Catalogs declared elsewhere (`versionCatalogs { … from(files(…)) }` in
 * settings) are not found; a reference to one stays unresolved.
 *
 * @module lang-kit/gradle-catalog
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { BuildValue } from "./build-model.js";
import { parseToml, TomlSyntaxError, type TomlTable, type TomlValue } from "./toml-lite.js";

export interface CatalogLibrary {
  readonly group: string;
  readonly artifact: string;
  /** Absent when the catalog declares none (a BOM or plugin manages it). */
  readonly version?: BuildValue;
}

export interface CatalogPlugin {
  readonly id: string;
  readonly version?: BuildValue;
}

export interface VersionCatalog {
  readonly name: string;
  /** Accessor key (`a.b.c`) → value. */
  readonly versions: ReadonlyMap<string, BuildValue>;
  readonly libraries: ReadonlyMap<string, CatalogLibrary>;
  readonly plugins: ReadonlyMap<string, CatalogPlugin>;
  /** Accessor key → library accessor keys. */
  readonly bundles: ReadonlyMap<string, readonly string[]>;
}

export type CatalogRef =
  | { readonly kind: "library"; readonly library: CatalogLibrary }
  | { readonly kind: "bundle"; readonly libraries: readonly CatalogLibrary[] }
  | { readonly kind: "plugin"; readonly plugin: CatalogPlugin }
  | { readonly kind: "version"; readonly version: BuildValue }
  | { readonly kind: "missing"; readonly reason: string };

const CATALOG_SUFFIX = ".versions.toml";
/** Preference order when a version is a rich declaration: the most binding constraint first. */
const RICH_VERSION_KEYS = ["strictly", "require", "prefer"];

/** Every `gradle/*.versions.toml` under `projectDir`, keyed by catalog name; unreadable ones become notices. */
export async function readVersionCatalogs(
  projectDir: string,
): Promise<{ catalogs: Map<string, VersionCatalog>; notices: string[] }> {
  const catalogs = new Map<string, VersionCatalog>();
  const notices: string[] = [];
  const gradleDir = join(projectDir, "gradle");
  let files: string[];
  try {
    files = (await readdir(gradleDir)).filter((f) => f.endsWith(CATALOG_SUFFIX)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") {
      return { catalogs, notices };
    }
    throw err;
  }
  for (const file of files) {
    const name = file.slice(0, -CATALOG_SUFFIX.length);
    try {
      catalogs.set(name, toCatalog(name, parseToml(await readFile(join(gradleDir, file), "utf8"))));
    } catch (err) {
      if (!(err instanceof TomlSyntaxError)) throw err;
      notices.push(`gradle/${file} is not valid TOML: ${err.message}`);
    }
  }
  return { catalogs, notices };
}

/** Parse catalog TOML into a catalog. Exported for tests. */
export function toCatalog(name: string, doc: TomlTable): VersionCatalog {
  const versions = new Map<string, BuildValue>();
  for (const [key, v] of Object.entries(table(doc.versions))) {
    const value = versionText(v);
    versions.set(accessor(key), value ? exact(value) : { resolved: false, reason: `version ${key} is not a plain or rich version` });
  }
  const resolve = (v: TomlValue | undefined): BuildValue | undefined => versionOf(v, versions);

  const libraries = new Map<string, CatalogLibrary>();
  for (const [key, v] of Object.entries(table(doc.libraries))) {
    const lib = libraryOf(v, resolve);
    if (lib) libraries.set(accessor(key), lib);
  }
  const plugins = new Map<string, CatalogPlugin>();
  for (const [key, v] of Object.entries(table(doc.plugins))) {
    const plugin = pluginOf(v, resolve);
    if (plugin) plugins.set(accessor(key), plugin);
  }
  const bundles = new Map<string, string[]>();
  for (const [key, v] of Object.entries(table(doc.bundles))) {
    if (Array.isArray(v)) bundles.set(accessor(key), v.filter((x): x is string => typeof x === "string").map(accessor));
  }
  return { name, versions, libraries, plugins, bundles };
}

/**
 * Follow a script reference like `libs.spring.boot.starter` (optionally ending
 * `.get()`, `.asProvider()` or `.get().toInt()`): `undefined` when it is not
 * addressed to a known catalog, `missing` when the catalog lacks the entry.
 */
export function resolveCatalogRef(catalogs: ReadonlyMap<string, VersionCatalog>, expr: string): CatalogRef | undefined {
  const m = /^([A-Za-z_]\w*)\.([A-Za-z_][\w.]*?)(?:\.(?:get|asProvider)\(\)(?:\.to\w+\(\))?)?$/.exec(expr.trim());
  const catalog = m && catalogs.get(m[1]);
  if (!m || !catalog) return undefined;
  const path = m[2];
  const section = /^(bundles|plugins|versions)\.(.+)$/.exec(path);
  const missing = (what: string): CatalogRef => ({ kind: "missing", reason: `${m[1]}.${path} is not a ${what} in the ${m[1]} version catalog` });

  if (section?.[1] === "versions") {
    const version = catalog.versions.get(section[2]);
    return version ? { kind: "version", version } : missing("version");
  }
  if (section?.[1] === "plugins") {
    const plugin = catalog.plugins.get(section[2]);
    return plugin ? { kind: "plugin", plugin } : missing("plugin");
  }
  if (section?.[1] === "bundles") {
    const keys = catalog.bundles.get(section[2]);
    return keys ? { kind: "bundle", libraries: keys.flatMap((k) => catalog.libraries.get(k) ?? []) } : missing("bundle");
  }
  const library = catalog.libraries.get(path);
  return library ? { kind: "library", library } : missing("library");
}

// ── TOML → catalog entries ───────────────────────────────────────────────

/** Gradle turns `-`, `_` and `.` in a catalog key into accessor separators. */
function accessor(key: string): string {
  return key.replace(/[-_]/g, ".");
}

function exact(value: string): BuildValue {
  return { resolved: true, value };
}

function table(v: TomlValue | undefined): TomlTable {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/** A plain version string, or the most binding constraint of a rich version. */
function versionText(v: TomlValue | undefined): string | undefined {
  if (typeof v === "string") return v;
  const rich = table(v);
  for (const key of RICH_VERSION_KEYS) if (typeof rich[key] === "string") return rich[key];
  return undefined;
}

/** `version = "1"`, `version.ref = "x"`, `version = { ref = "x" }`, or a rich version; undefined when none is declared. */
function versionOf(v: TomlValue | undefined, versions: ReadonlyMap<string, BuildValue>): BuildValue | undefined {
  if (v === undefined) return undefined;
  const ref = table(v).ref;
  if (typeof ref === "string") {
    return versions.get(accessor(ref)) ?? { resolved: false, reason: `version.ref "${ref}" is not in [versions]` };
  }
  const text = versionText(v);
  return text !== undefined ? exact(text) : { resolved: false, reason: "version is not a string, a ref or a rich version" };
}

function libraryOf(
  v: TomlValue,
  resolve: (version: TomlValue | undefined) => BuildValue | undefined,
): CatalogLibrary | undefined {
  if (typeof v === "string") {
    const [group, artifact, version] = v.split(":");
    return group && artifact ? { group, artifact, ...(version !== undefined && { version: exact(version) }) } : undefined;
  }
  const t = table(v);
  let group = typeof t.group === "string" ? t.group : undefined;
  let artifact = typeof t.name === "string" ? t.name : undefined;
  if (typeof t.module === "string") [group, artifact] = t.module.split(":");
  if (!group || !artifact) return undefined;
  const version = resolve(t.version);
  return { group, artifact, ...(version && { version }) };
}

function pluginOf(
  v: TomlValue,
  resolve: (version: TomlValue | undefined) => BuildValue | undefined,
): CatalogPlugin | undefined {
  if (typeof v === "string") {
    const [id, version] = v.split(":");
    return id ? { id, ...(version !== undefined && { version: exact(version) }) } : undefined;
  }
  const t = table(v);
  if (typeof t.id !== "string") return undefined;
  const version = resolve(t.version);
  return { id: t.id, ...(version && { version }) };
}
