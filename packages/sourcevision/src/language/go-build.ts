/**
 * Go build model: module path, dependencies and versions from `go.mod`, and
 * the workspace directives of `go.work`. Files are parsed as text, never with
 * the `go` tool, and the result is held in memory only.
 *
 * Each `go.mod` becomes a {@link ModuleBuildModel} (`buildSystem: "go"`).
 * Dependencies follow the shared conventions: `group` is the module path up to
 * its last element, `artifact` is that last element (so `group/artifact` is
 * always the module path, including a `/v2` suffix), and `scope` is `direct`
 * or `indirect`. Facts with no shared field (directives, `replace`,
 * `exclude`) live in {@link GoModFacts}.
 *
 * A malformed line becomes a notice and the rest of the file is still read.
 *
 * @module sourcevision/language/go-build
 */

import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { BuildDependency, ModuleBuildModel } from "./build-model.js";
import { goConfig } from "./go.js";

/** A module path with an optional version. A `replace` target without a version is a local path. */
export interface GoModuleRef {
  readonly path: string;
  readonly version?: string;
}

/** `replace old[ version] => new[ version]`. A `new` with no version is a directory path. */
export interface GoReplace {
  readonly old: GoModuleRef;
  readonly new: GoModuleRef;
  /** True when the target is a local directory rather than a module version. */
  readonly local: boolean;
}

export interface GoModFacts {
  /** The `go` directive, e.g. `1.21`. */
  readonly go?: string;
  /** The `toolchain` directive, e.g. `go1.22.1`. */
  readonly toolchain?: string;
  readonly replaces: readonly GoReplace[];
  readonly excludes: readonly GoModuleRef[];
}

/** A `go.mod` module: the shared model plus the Go-only facts. */
export interface GoModuleBuild extends ModuleBuildModel {
  readonly buildSystem: "go";
  readonly goMod: GoModFacts;
}

export interface GoWorkFacts {
  /** Path of the file relative to the project root, POSIX. */
  readonly file: string;
  readonly go?: string;
  readonly toolchain?: string;
  /** `use` directories, as written. */
  readonly use: readonly string[];
  readonly replaces: readonly GoReplace[];
  readonly notices: readonly string[];
}

/** Directories (relative, POSIX; "" is the root) holding a `go.mod`, sorted. */
export async function findGoModuleDirs(projectDir: string): Promise<string[]> {
  return findDirsWith(projectDir, "go.mod");
}

/** Build models for the `go.mod` files of a project, one per directory in `dirs` (default: every `go.mod` found). */
export async function readGoBuildModels(
  projectDir: string,
  dirs?: readonly string[],
): Promise<GoModuleBuild[]> {
  const out: GoModuleBuild[] = [];
  for (const dir of dirs ?? (await findGoModuleDirs(projectDir))) {
    out.push(await readModule(projectDir, dir));
  }
  return out;
}

/** The `go.work` files of a project, one per directory that has one, sorted by path. */
export async function readGoWorkFiles(projectDir: string): Promise<GoWorkFacts[]> {
  const out: GoWorkFacts[] = [];
  for (const dir of await findDirsWith(projectDir, "go.work")) {
    const file = posix.join(dir, "go.work");
    const text = await readText(join(projectDir, file));
    out.push(typeof text === "string" ? parseGoWork(file, text) : { file, use: [], replaces: [], notices: [`${file} ${text.reason}`] });
  }
  return out;
}

// ── go.mod ───────────────────────────────────────────────────────────────

async function readModule(projectDir: string, dir: string): Promise<GoModuleBuild> {
  const file = posix.join(dir, "go.mod");
  const text = await readText(join(projectDir, file));
  if (typeof text !== "string") {
    return { module: dir, dir, buildSystem: "go", dependencies: [], notices: [`${file} ${text.reason}`], goMod: { replaces: [], excludes: [] } };
  }
  return parseGoMod(dir, file, text);
}

/** Parse one `go.mod`. Exported for tests; production code goes through {@link readGoBuildModels}. */
export function parseGoMod(dir: string, file: string, text: string): GoModuleBuild {
  const notices: string[] = [];
  const deps: BuildDependency[] = [];
  const replaces: GoReplace[] = [];
  const excludes: GoModuleRef[] = [];
  let modulePath: string | undefined;
  let go: string | undefined;
  let toolchain: string | undefined;

  for (const d of directives(text, file, notices)) {
    const { verb, args, indirect, line } = d;
    const bad = (why: string): void => void notices.push(`${file}:${line}: ${verb} ${why}`);
    switch (verb) {
      case "module":
        if (args.length === 1) modulePath = args[0];
        else bad("expects one module path");
        break;
      case "go":
        if (args.length === 1) go = args[0];
        else bad("expects one version");
        break;
      case "toolchain":
        if (args.length === 1) toolchain = args[0];
        else bad("expects one toolchain name");
        break;
      case "require":
        if (args.length === 2) deps.push(dependency(args[0], args[1], indirect));
        else bad("expects a module path and a version");
        break;
      case "exclude":
        if (args.length === 2) excludes.push({ path: args[0], version: args[1] });
        else bad("expects a module path and a version");
        break;
      case "replace": {
        const r = parseReplace(args);
        if (r) replaces.push(r);
        else bad("expects `old [version] => new [version]`");
        break;
      }
      default:
        break; // godebug, retract, tool, ignore: no shared or modelled meaning
    }
  }
  if (modulePath === undefined) notices.push(`${file} has no module directive`);

  const split = modulePath === undefined ? undefined : splitPath(modulePath);
  return {
    module: modulePath ?? dir,
    dir,
    buildSystem: "go",
    ...(split && split.group !== "" && { group: { resolved: true as const, value: split.group } }),
    dependencies: deps.sort(compareDeps),
    notices,
    goMod: {
      ...(go !== undefined && { go }),
      ...(toolchain !== undefined && { toolchain }),
      replaces,
      excludes,
    },
  };
}

function dependency(path: string, version: string, indirect: boolean): BuildDependency {
  const { group, artifact } = splitPath(path);
  return { group, artifact, version: { resolved: true, value: version }, scope: indirect ? "indirect" : "direct" };
}

function compareDeps(a: BuildDependency, b: BuildDependency): number {
  const key = (d: BuildDependency): string => `${d.group}:${d.artifact}:${d.version.resolved ? d.version.value : ""}`;
  return key(a).localeCompare(key(b));
}

/** `github.com/a/b/v2` → group `github.com/a/b`, artifact `v2`; a single element has an empty group. */
function splitPath(path: string): { group: string; artifact: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { group: "", artifact: path } : { group: path.slice(0, i), artifact: path.slice(i + 1) };
}

// ── go.work ──────────────────────────────────────────────────────────────

/** Parse one `go.work`. Exported for tests; production code goes through {@link readGoWorkFiles}. */
export function parseGoWork(file: string, text: string): GoWorkFacts {
  const notices: string[] = [];
  const use: string[] = [];
  const replaces: GoReplace[] = [];
  let go: string | undefined;
  let toolchain: string | undefined;

  for (const { verb, args, line } of directives(text, file, notices)) {
    const bad = (why: string): void => void notices.push(`${file}:${line}: ${verb} ${why}`);
    switch (verb) {
      case "go":
        if (args.length === 1) go = args[0];
        else bad("expects one version");
        break;
      case "toolchain":
        if (args.length === 1) toolchain = args[0];
        else bad("expects one toolchain name");
        break;
      case "use":
        if (args.length === 1) use.push(args[0]);
        else bad("expects one directory");
        break;
      case "replace": {
        const r = parseReplace(args);
        if (r) replaces.push(r);
        else bad("expects `old [version] => new [version]`");
        break;
      }
      default:
        break; // godebug
    }
  }
  return { file, ...(go !== undefined && { go }), ...(toolchain !== undefined && { toolchain }), use, replaces, notices };
}

// ── Shared line parsing ──────────────────────────────────────────────────

interface Directive {
  verb: string;
  args: string[];
  /** The line carried a `// indirect` comment. */
  indirect: boolean;
  /** 1-based line number. */
  line: number;
}

/** Flatten `verb ( … )` blocks into one directive per entry. An unterminated block is a notice. */
function directives(text: string, file: string, notices: string[]): Directive[] {
  const out: Directive[] = [];
  let block: { verb: string; line: number } | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const { fields, comment } = tokenize(raw);
    if (fields.length === 0) return;
    const indirect = /^\s*indirect\b/.test(comment);
    if (block) {
      if (fields.length === 1 && fields[0] === ")") block = undefined;
      else out.push({ verb: block.verb, args: fields, indirect, line });
      return;
    }
    if (fields.length === 2 && fields[1] === "(") {
      block = { verb: fields[0], line };
      return;
    }
    out.push({ verb: fields[0], args: fields.slice(1), indirect, line });
  });
  if (block) notices.push(`${file}:${block.line}: ${block.verb} block is not closed`);
  return out;
}

/** Split a line into fields (quoted strings unquoted) and its trailing `//` comment. */
function tokenize(line: string): { fields: string[]; comment: string } {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") {
      i++;
    } else if (c === "/" && line[i + 1] === "/") {
      return { fields, comment: line.slice(i + 2) };
    } else if (c === '"' || c === "`") {
      const end = line.indexOf(c, i + 1);
      const stop = end < 0 ? line.length : end;
      fields.push(line.slice(i + 1, stop));
      i = stop + 1;
    } else {
      let j = i;
      while (j < line.length && line[j] !== " " && line[j] !== "\t" && !(line[j] === "/" && line[j + 1] === "/")) j++;
      fields.push(line.slice(i, j));
      i = j;
    }
  }
  return { fields, comment: "" };
}

/** `old [version] => new [version]`; the target is local when it carries no version. */
function parseReplace(args: readonly string[]): GoReplace | undefined {
  const arrow = args.indexOf("=>");
  if (arrow < 1 || arrow > 2) return undefined;
  const left = args.slice(0, arrow);
  const right = args.slice(arrow + 1);
  if (right.length < 1 || right.length > 2) return undefined;
  return {
    old: ref(left),
    new: ref(right),
    local: right.length === 1,
  };
}

function ref(parts: readonly string[]): GoModuleRef {
  return parts.length === 2 ? { path: parts[0], version: parts[1] } : { path: parts[0] };
}

// ── Filesystem ───────────────────────────────────────────────────────────

async function readText(path: string): Promise<string | { reason: string }> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { reason: "not found" };
    if (code === "EACCES" || code === "EISDIR" || code === "EPERM") return { reason: `is unreadable (${code})` };
    throw err;
  }
}

async function findDirsWith(projectDir: string, filename: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(join(projectDir, rel), { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || e.name === "node_modules" || goConfig.skipDirectories.has(e.name)) continue;
        await walk(posix.join(rel, e.name));
      } else if (e.name === filename) {
        found.push(rel);
      }
    }
  }
  await walk("");
  return found.sort();
}
