/**
 * Java module and source-root discovery. Reads build files as text; never
 * runs Maven or Gradle, so only literal values are understood (property
 * placeholders, computed paths and plugin-added roots are not).
 *
 * Maven: root `pom.xml` and each `<modules>` entry, recursively. Gradle:
 * `include` entries in `settings.gradle(.kts)` with literal `projectDir`
 * overrides. With no build file, roots come from `package` declarations.
 *
 * @module sourcevision/language/java-modules
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { javaConfig } from "./java.js";

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
}

const DEFAULT_ROOTS = ["src/main/java", "src/test/java"];
const GRADLE_SETTINGS = ["settings.gradle", "settings.gradle.kts"];
const GRADLE_BUILD = ["build.gradle", "build.gradle.kts"];

/** Find Java modules and their source roots under `projectDir`. */
export async function discoverJavaModules(projectDir: string): Promise<JavaModuleLayout> {
  if (await isFile(join(projectDir, "pom.xml"))) {
    return { buildSystem: "maven", modules: await readMavenModules(projectDir) };
  }
  const settings = await firstFile(projectDir, GRADLE_SETTINGS);
  const build = await firstFile(projectDir, GRADLE_BUILD);
  if (settings || build) {
    return { buildSystem: "gradle", modules: await readGradleModules(projectDir, settings, build) };
  }
  const roots = await packageDeclarationRoots(projectDir);
  const modules = roots.length ? [{ name: basename(projectDir), dir: "", sourceRoots: roots }] : [];
  return { buildSystem: "none", modules };
}

// ── Maven ────────────────────────────────────────────────────────────────

async function readMavenModules(projectDir: string): Promise<JavaModule[]> {
  const modules: JavaModule[] = [];
  const seen = new Set<string>();

  async function visit(dir: string): Promise<void> {
    if (seen.has(dir)) return;
    seen.add(dir);
    const pom = await readText(join(projectDir, dir, "pom.xml"));
    if (pom === null) return;
    const xml = pom.replace(/<!--[\s\S]*?-->/g, "");

    const declared = [...tagValues(xml, "sourceDirectory"), ...tagValues(xml, "testSourceDirectory")].map(
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

function tagValues(xml: string, tag: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "g"))) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** The first artifactId outside `<parent>` names the module. */
function mavenArtifactId(xml: string): string | undefined {
  return tagValues(xml.replace(/<parent>[\s\S]*?<\/parent>/, ""), "artifactId")[0];
}

/** Profile-scoped `<modules>` are included: a superset beats a missing module. */
function modulesBlock(xml: string): string[] {
  return [...xml.matchAll(/<modules>([\s\S]*?)<\/modules>/g)].flatMap((m) => tagValues(m[1], "module"));
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
): Promise<JavaModule[]> {
  const settings = settingsFile ? stripGradleComments((await readText(settingsFile)) ?? "") : "";
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
    const build = e.buildFile ? stripGradleComments((await readText(e.buildFile)) ?? "") : "";
    modules.push({
      name: e.name,
      dir: e.dir,
      sourceRoots: await existingRoots(projectDir, e.dir, gradleSrcDirs(build)),
    });
  }
  return modules;
}

function stripGradleComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
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

/** Roots inferred from `package` declarations; skips directories the Java config skips. */
async function packageDeclarationRoots(projectDir: string): Promise<string[]> {
  const roots = new Set<string>();

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "node_modules" || javaConfig.skipDirectories.has(e.name)) continue;
        await walk(join(dir, e.name));
      } else if (e.name.endsWith(".java")) {
        const root = await rootFromPackage(projectDir, join(dir, e.name));
        if (root !== null) roots.add(root);
      }
    }
  }

  await walk(projectDir);
  return [...roots].sort();
}

/** The directory a file's package path hangs off, or null when path and package disagree. */
async function rootFromPackage(projectDir: string, file: string): Promise<string | null> {
  const text = (await readText(file)) ?? "";
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
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

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
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
