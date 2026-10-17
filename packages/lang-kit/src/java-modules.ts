/**
 * Java module and source-root discovery. Reads build files as text; never
 * runs Maven or Gradle, so only literal values are understood (property
 * placeholders, computed paths and plugin-added roots are not).
 *
 * Maven: root `pom.xml` and each `<modules>` entry, recursively. Gradle:
 * `include` entries in `settings.gradle(.kts)` with literal `projectDir`
 * overrides. With no build file, roots come from `package` declarations.
 *
 * @module lang-kit/java-modules
 */

import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { oversizedNotice, readBuildFile, type OversizedBuildFile } from "./build-file.js";
import { javaConfig } from "./java.js";
import { skipsDirectory } from "./registry.js";

export type JavaBuildSystem = "maven" | "gradle" | "none";

export interface JavaModule {
  /** Maven artifactId, Gradle project path (`:a:b`), or directory name. */
  name: string;
  /** Module directory relative to the project root, POSIX; "" is the root. */
  dir: string;
  /** Source roots relative to the project root, POSIX, existing directories only. */
  sourceRoots: string[];
}

export interface JavaModuleLayout {
  buildSystem: JavaBuildSystem;
  modules: JavaModule[];
  /** Directories the search could not list; present only when there are any. */
  notices?: string[];
}

const DEFAULT_ROOTS = ["src/main/java", "src/test/java"];
const GRADLE_SETTINGS = ["settings.gradle", "settings.gradle.kts"];
export const GRADLE_BUILD = ["build.gradle", "build.gradle.kts"];

/** Find Java modules and their source roots under `projectDir`. */
export async function discoverJavaModules(projectDir: string): Promise<JavaModuleLayout> {
  const notices: string[] = [];
  const withNotices = (layout: JavaModuleLayout): JavaModuleLayout =>
    notices.length ? { ...layout, notices } : layout;
  if (await isFile(join(projectDir, "pom.xml"))) {
    return withNotices({ buildSystem: "maven", modules: await readMavenModules(projectDir, notices) });
  }
  const settings = await firstFile(projectDir, GRADLE_SETTINGS);
  const build = await firstFile(projectDir, GRADLE_BUILD);
  if (settings || build) {
    return withNotices({
      buildSystem: "gradle",
      modules: await readGradleModules(projectDir, settings, build, notices),
    });
  }
  const roots = await packageDeclarationRoots(projectDir, notices);
  const modules = roots.length ? [{ name: basename(projectDir), dir: "", sourceRoots: roots }] : [];
  return withNotices({ buildSystem: "none", modules });
}

// ── Maven ────────────────────────────────────────────────────────────────

const COMMENT_OPEN = "<!--";

/**
 * Remove XML comments in one linear scan. The result never contains `<!--`:
 * an opener that only forms once a comment is removed (`<!<!-- x -->-- -->`)
 * is itself treated as a comment, as repeating a single-pass strip until
 * nothing changes would. An unterminated comment runs to the end of the file.
 */
export function stripXmlComments(xml: string): string {
  let out = "";
  let i = 0;
  while (i < xml.length) {
    // Characters of an opener already kept at the end of `out`, completed by `xml` at `i`.
    let kept = COMMENT_OPEN.length - 1;
    while (kept > 0 && !(out.endsWith(COMMENT_OPEN.slice(0, kept)) && xml.startsWith(COMMENT_OPEN.slice(kept), i))) {
      kept--;
    }
    let body: number;
    if (kept > 0) {
      out = out.slice(0, -kept);
      body = i + COMMENT_OPEN.length - kept;
    } else {
      const open = xml.indexOf(COMMENT_OPEN, i);
      if (open < 0) return out + xml.slice(i);
      out += xml.slice(i, open);
      body = open + COMMENT_OPEN.length;
    }
    const close = xml.indexOf("-->", body);
    if (close < 0) return out;
    i = close + 3;
  }
  return out;
}

/**
 * Spans `open…close`, leftmost first and non-overlapping, as the lazy
 * `/open[\s\S]*?close/g` matches them, in linear time: that regex rescans to
 * the end from every opener when the closer is missing.
 */
function* spans(src: string, open: string, close: string): Generator<{ start: number; inner: string; end: number }> {
  let i = 0;
  for (;;) {
    const start = src.indexOf(open, i);
    if (start < 0) return;
    const closeAt = src.indexOf(close, start + open.length);
    // No later opener has a closer either.
    if (closeAt < 0) return;
    i = closeAt + close.length;
    yield { start, inner: src.slice(start + open.length, closeAt), end: i };
  }
}

/** `src` without its first `limit` `open…close` spans. */
function removeSpans(src: string, open: string, close: string, limit = Infinity): string {
  let out = "";
  let from = 0;
  let removed = 0;
  for (const span of spans(src, open, close)) {
    if (removed++ >= limit) break;
    out += src.slice(from, span.start);
    from = span.end;
  }
  return out + src.slice(from);
}

const tagBlocks = (xml: string, tag: string) => spans(xml, `<${tag}>`, `</${tag}>`);
const removeBlocks = (xml: string, tag: string, limit?: number) => removeSpans(xml, `<${tag}>`, `</${tag}>`, limit);

async function readMavenModules(projectDir: string, notices: string[]): Promise<JavaModule[]> {
  const modules: JavaModule[] = [];
  const seen = new Set<string>();

  async function visit(dir: string): Promise<void> {
    if (seen.has(dir)) return;
    seen.add(dir);
    const pom = await readText(projectDir, join(projectDir, dir, "pom.xml"), notices);
    if (pom === null) return;
    const xml = stripXmlComments(pom);
    // Plugin configuration reuses the tag name (antlr4, protobuf, ...) for non-Java roots.
    const build = removeBlocks(xml, "plugins");

    const declared = [...tagValues(build, "sourceDirectory"), ...tagValues(build, "testSourceDirectory")].map(
      resolveMavenPath,
    );
    modules.push({
      name: mavenArtifactId(xml) ?? (basename(dir) || basename(projectDir)),
      dir,
      sourceRoots: await existingRoots(projectDir, dir, declared),
    });

    for (const entry of modulesBlock(xml)) {
      // An entry may name a directory or a pom file inside one.
      const rel = entry.endsWith(".xml") ? posix.dirname(entry) : entry;
      await visit(normalizeDir(posix.join(dir, rel)));
    }
  }

  await visit("");
  return modules;
}

/**
 * Trimmed, non-empty text of each `<tag>text</tag>` with no markup inside.
 * Trimmed in JS: `\s*` beside a lazy `[^<]*?` backtracks without bound when
 * the closing tag is missing.
 */
function tagValues(xml: string, tag: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))) {
    const value = m[1]!.trim();
    if (value) out.push(value);
  }
  return out;
}

/** The first artifactId outside `<parent>` names the module. */
function mavenArtifactId(xml: string): string | undefined {
  return tagValues(removeBlocks(xml, "parent", 1), "artifactId")[0];
}

/** Profile-scoped `<modules>` are included: a superset beats a missing module. */
function modulesBlock(xml: string): string[] {
  return [...tagBlocks(xml, "modules")].flatMap((b) => tagValues(b.inner, "module"));
}

/** Module-relative path, or "" when it depends on an unresolved placeholder. */
function resolveMavenPath(value: string): string {
  const resolved = value.replace(/^\$\{(?:project\.basedir|basedir)\}\/?/, "");
  return resolved.includes("${") ? "" : resolved;
}

// ── Gradle ───────────────────────────────────────────────────────────────

async function readGradleModules(
  projectDir: string,
  settingsFile: string | null,
  rootBuildFile: string | null,
  notices: string[],
): Promise<JavaModule[]> {
  const settings = settingsFile ? stripGradleComments((await readText(projectDir, settingsFile, notices)) ?? "") : "";
  const overrides = projectDirOverrides(settings);

  const paths = new Set<string>();
  for (const p of gradleIncludes(settings)) {
    // include("a:b") also creates the intermediate project "a".
    const parts = p.split(":").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join(":"));
  }

  const entries: Array<{ name: string; dir: string; buildFile: string | null }> = [
    { name: ":", dir: "", buildFile: rootBuildFile },
  ];
  for (const path of [...paths].sort()) {
    const dir = normalizeDir(overrides.get(path) ?? path.split(":").join("/"));
    if (!(await isDirectory(join(projectDir, dir)))) continue;
    entries.push({ name: `:${path}`, dir, buildFile: await firstFile(join(projectDir, dir), GRADLE_BUILD) });
  }

  const modules: JavaModule[] = [];
  for (const e of entries) {
    const build = e.buildFile ? stripGradleComments((await readText(projectDir, e.buildFile, notices)) ?? "") : "";
    modules.push({
      name: e.name,
      dir: e.dir,
      sourceRoots: await existingRoots(projectDir, e.dir, gradleSrcDirs(build)),
    });
  }
  return modules;
}

function stripGradleComments(src: string): string {
  return removeSpans(src, "/*", "*/").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

/** `include(":a", ":b:c")`, `include 'a', 'b'`, across lines. */
function gradleIncludes(settings: string): string[] {
  const out: string[] = [];
  for (const m of settings.matchAll(/\binclude\s*\(?\s*((?:["'][^"'\n]+["']\s*,?\s*)+)/g)) {
    for (const s of m[1].matchAll(/["']([^"'\n]+)["']/g)) out.push(s[1].replace(/^:/, ""));
  }
  return out;
}

/** `project(":x").projectDir = file("p")` and `new File(settingsDir, "p")`. */
function projectDirOverrides(settings: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /(?:project|findProject)\(\s*["']:?([^"']+)["']\s*\)[?!]*\.projectDir\s*=\s*(?:new\s+)?(?:file|File)\(\s*(?:settingsDir\s*,\s*)?["']([^"']+)["']\s*\)/g;
  for (const m of settings.matchAll(re)) map.set(m[1], m[2]);
  return map;
}

/** Literal strings in `java { srcDirs … }`, `java.srcDir(…)`, `java.setSrcDirs(…)`. */
function gradleSrcDirs(build: string): string[] {
  const out: string[] = [];
  const starts = /\bjava\s*(?:\{[^{}]*?\b(?:srcDirs?|setSrcDirs)\b|\.(?:srcDirs?|setSrcDirs)\b)/g;
  for (const m of build.matchAll(starts)) {
    const tail = statementTail(build, m.index + m[0].length);
    for (const s of tail.matchAll(/["']([^"'$\n]+)["']/g)) out.push(s[1]);
  }
  return out;
}

/** Text from `from` to the end of the statement: the line, extended across open brackets. */
function statementTail(src: string, from: number): string {
  let depth = 0;
  let i = from;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "}" && depth <= 0) break;
    else if (c === "\n" && depth <= 0) break;
  }
  return src.slice(from, i);
}

// ── No build file ────────────────────────────────────────────────────────

/**
 * Roots inferred from `package` declarations; skips directories the Java config
 * skips. A directory that cannot be listed is skipped and reported as a notice.
 */
async function packageDeclarationRoots(projectDir: string, notices: string[]): Promise<string[]> {
  const roots = new Set<string>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EACCES" && code !== "EPERM" && code !== "ENOENT" && code !== "ENOTDIR") throw err;
      notices.push(`${toPosix(relative(projectDir, dir)) || "."} is unreadable (${code}); skipped`);
      return;
    }
    const fileNames = new Set(entries.filter((e) => !e.isDirectory()).map((e) => e.name));
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const sub = join(dir, e.name);
        const place = { path: toPosix(relative(projectDir, sub)), parentHolds: (file: string) => fileNames.has(file) };
        if (skipsDirectory(javaConfig, e.name, (file) => existsSync(join(sub, file)), place)) continue;
        await walk(sub);
      } else if (e.name.endsWith(".java")) {
        const root = await rootFromPackage(projectDir, join(dir, e.name), notices);
        if (root !== null) roots.add(root);
      }
    }
  }

  await walk(projectDir);
  return [...roots].sort();
}

/** The directory a file's package path hangs off, or null when path and package disagree. */
async function rootFromPackage(projectDir: string, file: string, notices: string[]): Promise<string | null> {
  const text = await readText(projectDir, file, notices, (path) => readFile(path, "utf8"));
  if (text === null) return null;
  const code = removeSpans(text, "/*", "*/").replace(/\/\/.*$/gm, "");
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(code)?.[1];
  const fileDir = toPosix(relative(projectDir, dirname(file)));
  if (!pkg) return fileDir; // default package: the directory is the root
  const pkgPath = pkg.split(".").join("/");
  if (fileDir === pkgPath) return "";
  return fileDir.endsWith(`/${pkgPath}`) ? fileDir.slice(0, -pkgPath.length - 1) : null;
}

// ── Shared ───────────────────────────────────────────────────────────────

/** Defaults plus declared roots, module-relative → project-relative, existing only, deduplicated. */
async function existingRoots(projectDir: string, moduleDir: string, declared: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const rel of [...DEFAULT_ROOTS, ...declared]) {
    if (!rel) continue;
    const root = normalizeDir(posix.join(moduleDir, rel));
    if (!found.includes(root) && (await isDirectory(join(projectDir, root)))) found.push(root);
  }
  return found;
}

function normalizeDir(p: string): string {
  const n = posix.normalize(toPosix(p)).replace(/\/$/, "");
  return n === "." ? "" : n;
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * File text, a build file by default; null when absent, or when unreadable
 * (EACCES/EPERM) or over the build file size cap, both reported as a notice.
 */
async function readText(
  projectDir: string,
  path: string,
  notices: string[],
  read: (path: string) => Promise<string | OversizedBuildFile> = readBuildFile,
): Promise<string | null> {
  try {
    const text = await read(path);
    if (typeof text === "string") return text;
    notices.push(oversizedNotice(toPosix(relative(projectDir, path)), text.oversized));
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (code !== "EACCES" && code !== "EPERM") throw err;
    notices.push(`${toPosix(relative(projectDir, path))} is unreadable (${code}); skipped`);
    return null;
  }
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

async function firstFile(dir: string, names: string[]): Promise<string | null> {
  for (const n of names) if (await isFile(join(dir, n))) return join(dir, n);
  return null;
}
