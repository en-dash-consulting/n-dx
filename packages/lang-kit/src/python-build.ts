/**
 * Python project metadata, read as text: `pyproject.toml` (PEP 621, PEP 735,
 * Poetry, setuptools, hatch, the uv workspace), `setup.cfg`, requirements
 * files with their includes, and the literal arguments of `setup.py`'s
 * `setup(...)`. No interpreter, pip or build backend is run, and `setup.py`
 * is never executed. Held in memory only.
 *
 * A project is a directory holding `pyproject.toml`, `setup.cfg` or
 * `setup.py`, or requirements files that no such directory owns
 * (`requirements*.txt` beside it, or `*.txt` in a `requirements/` directory
 * under it). Each yields its name, its source roots, the top-level packages
 * it lists and its dependencies with the file and line they came from.
 * Malformed input becomes a notice; nothing throws on file content.
 *
 * @module lang-kit/python-build
 */

import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { parseIni, type IniValue } from "./ini-lite.js";
import {
  type PythonDependency,
  type PythonReference,
  type ReadRepoText,
  dependencyOf,
  readRequirementsFiles,
  requirementDependency,
} from "./python-requirements.js";
import { NON_LITERAL, type PyLiteral, type SetupArgument, readSetupCall } from "./python-setup-py.js";
import { type LocatedToml, type TomlTable, type TomlValue, TomlSyntaxError, parseTomlLocated } from "./toml-lite.js";

/** A directory Python packages and modules are imported from. */
export interface PythonSourceRoot {
  /** Relative to the repository root, POSIX; "" is the root. */
  readonly dir: string;
  /**
   * Set when the directory *is* one package (`package-dir = {"pkg" = "lib/pkg"}`,
   * hatch `sources = {"lib/pkg" = "pkg"}`); absent when packages live inside it.
   */
  readonly package?: string;
  /** Where it was declared (`pyproject.toml [tool.setuptools.package-dir]`), or `src layout` / `flat layout` when inferred. */
  readonly via: string;
  /** Inferred from the files, not declared: a project that declares no root. */
  readonly inferred?: true;
}

export interface PythonProject {
  /** Relative to the repository root, POSIX; "" is the root. */
  readonly dir: string;
  readonly name?: string;
  /** Metadata files read (requirements includes too), repository-relative, sorted. */
  readonly files: readonly string[];
  /** Sorted by directory, then package. Never empty: with nothing declared, the src or flat layout is inferred. */
  readonly sourceRoots: readonly PythonSourceRoot[];
  /** Top-level packages the metadata lists by name, sorted. Empty when it lists none (`find_packages`, auto-discovery). */
  readonly packages: readonly string[];
  /** Sorted by PEP 503 name, then file and line. */
  readonly dependencies: readonly PythonDependency[];
  /** Requirements-file lines naming a path, URL or editable install. */
  readonly references: readonly PythonReference[];
  /** `[tool.uv.workspace]` member directories, matched against the inventory, repository-relative, sorted. */
  readonly workspaceMembers?: readonly string[];
  readonly notices: readonly string[];
}

const METADATA = new Set(["pyproject.toml", "setup.cfg", "setup.py"]);

/**
 * Read the Python projects of a repository. `files` is the inventory
 * (repository-relative, POSIX); projects are found in it, and globs and
 * includes are matched against it, never against the disk.
 */
export async function readPythonProjects(projectDir: string, files: readonly string[]): Promise<PythonProject[]> {
  return pythonProjectsFrom(files, async (path) => {
    try {
      return await readFile(join(projectDir, path), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES" || code === "EISDIR" || code === "EPERM") return undefined;
      throw err;
    }
  });
}

/** {@link readPythonProjects} over any reader; tests pass an in-memory one. */
export async function pythonProjectsFrom(files: readonly string[], read: ReadRepoText): Promise<PythonProject[]> {
  const inventory = new Set(files);
  const metadataDirs = new Set<string>();
  for (const f of files) {
    const base = posix.basename(f);
    if (!METADATA.has(base)) continue;
    // A setup.py inside a package (beside an __init__.py) is a module named setup, not build metadata.
    if (base === "setup.py" && inventory.has(posix.join(posix.dirname(f), "__init__.py"))) continue;
    metadataDirs.add(dirOf(f));
  }
  const requirements = new Map<string, string[]>();
  for (const f of files) {
    const owner = requirementsOwner(f);
    if (owner === undefined) continue;
    requirements.set(owner, [...(requirements.get(owner) ?? []), f]);
  }
  const dirs = [...new Set([...metadataDirs, ...requirements.keys()])].sort();
  const out: PythonProject[] = [];
  for (const dir of dirs) {
    out.push(await readProject(dir, (requirements.get(dir) ?? []).sort(), { files, inventory, metadataDirs, read }));
  }
  return out;
}

interface Context {
  readonly files: readonly string[];
  readonly inventory: ReadonlySet<string>;
  readonly metadataDirs: ReadonlySet<string>;
  readonly read: ReadRepoText;
}

/** What one metadata file contributes. */
interface Collected {
  names: string[];
  roots: PythonSourceRoot[];
  packages: string[];
  dependencies: PythonDependency[];
  workspaceMembers?: string[];
  notices: string[];
}

async function readProject(dir: string, requirementFiles: readonly string[], ctx: Context): Promise<PythonProject> {
  const c: Collected = { names: [], roots: [], packages: [], dependencies: [], notices: [] };
  const read: string[] = [];
  const at = (name: string): string => (dir === "" ? name : `${dir}/${name}`);

  for (const name of ["pyproject.toml", "setup.cfg", "setup.py"]) {
    const file = at(name);
    if (!ctx.inventory.has(file) || (name === "setup.py" && ctx.inventory.has(at("__init__.py")))) continue;
    const text = await ctx.read(file);
    if (text === undefined) {
      c.notices.push(`${file} is unreadable`);
      continue;
    }
    read.push(file);
    if (name === "pyproject.toml") readPyproject(dir, file, text, c, ctx);
    else if (name === "setup.cfg") readSetupCfg(dir, file, text, c);
    else readSetupPy(dir, file, text, c);
  }

  const reqs = await readRequirementsFiles(requirementFiles, ctx.inventory, ctx.read);
  read.push(...reqs.files);
  c.dependencies.push(...reqs.dependencies);
  c.notices.push(...reqs.notices);

  const roots = c.roots.length > 0 ? c.roots : [inferRoot(dir, ctx.files)];
  return {
    dir,
    ...(c.names[0] !== undefined && { name: c.names[0] }),
    files: [...new Set(read)].sort(),
    sourceRoots: uniqueRoots(roots),
    packages: [...new Set(c.packages)].sort(),
    dependencies: c.dependencies.sort(compareDeps),
    references: reqs.references,
    ...(c.workspaceMembers && { workspaceMembers: [...new Set(c.workspaceMembers)].sort() }),
    notices: c.notices,
  };
}

/** Python files under the project's `src/` make it a src layout (namespace packages have no `__init__.py`); otherwise flat. */
function inferRoot(dir: string, files: readonly string[]): PythonSourceRoot {
  const src = dir === "" ? "src" : `${dir}/src`;
  const srcLayout = files.some((f) => f.startsWith(`${src}/`) && /\.pyi?$/.test(f));
  return srcLayout ? { dir: src, via: "src layout", inferred: true } : { dir, via: "flat layout", inferred: true };
}

// ── pyproject.toml ───────────────────────────────────────────────────────

function readPyproject(dir: string, file: string, text: string, c: Collected, ctx: Context): void {
  let doc: LocatedToml;
  try {
    doc = parseTomlLocated(text);
  } catch (err) {
    if (!(err instanceof TomlSyntaxError)) throw err;
    c.notices.push(`${file}:${err.line}: not read: ${err.message}`);
    return;
  }
  const lineOf = (path: readonly (string | number)[]): number => doc.lineOf(path) ?? 1;
  const strings = (path: readonly (string | number)[], value: TomlValue | undefined, scope: string): void => {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
      c.notices.push(`${file}:${lineOf(path)}: ${path.join(".")} is not an array`);
      return;
    }
    value.forEach((item, i) => {
      if (typeof item !== "string") return; // a PEP 735 `{include-group = …}` is not a requirement
      const dep = requirementDependency(item, scope, file, lineOf([...path, i]));
      if (dep) c.dependencies.push(dep);
      else c.notices.push(`${file}:${lineOf([...path, i])}: not a requirement: ${item}`);
    });
  };

  // PEP 621
  const project = table(doc.table, "project");
  if (typeof project?.name === "string") c.names.push(project.name);
  strings(["project", "dependencies"], project?.dependencies, "main");
  for (const [extra, list] of entries(table(project, "optional-dependencies"))) {
    strings(["project", "optional-dependencies", extra], list, `optional:${extra}`);
  }
  // PEP 735
  for (const [group, list] of entries(table(doc.table, "dependency-groups"))) {
    strings(["dependency-groups", group], list, `group:${group}`);
  }

  const tool = table(doc.table, "tool");
  readPoetry(dir, file, table(tool, "poetry"), lineOf, c);
  readSetuptools(dir, file, table(tool, "setuptools"), lineOf, c);
  readHatch(dir, file, table(table(table(table(tool, "hatch"), "build"), "targets"), "wheel"), lineOf, c);

  const workspace = table(table(tool, "uv"), "workspace");
  if (workspace) {
    const members = stringList(workspace.members);
    const excluded = stringList(workspace.exclude);
    const projectDirs = [...ctx.metadataDirs].filter((d) => ctx.inventory.has(d === "" ? "pyproject.toml" : `${d}/pyproject.toml`));
    const under = (pattern: string): RegExp => globRegExp(posix.normalize(posix.join(dir, pattern)));
    c.workspaceMembers = projectDirs.filter(
      (d) => d !== dir && members.some((m) => under(m).test(d)) && !excluded.some((e) => under(e).test(d)),
    );
  }
}

type LineOf = (path: readonly (string | number)[]) => number;

function readPoetry(dir: string, file: string, poetry: TomlTable | undefined, lineOf: LineOf, c: Collected): void {
  if (!poetry) return;
  if (typeof poetry.name === "string") c.names.push(poetry.name);
  const packages = poetry.packages;
  if (Array.isArray(packages)) {
    packages.forEach((p, i) => {
      if (typeof p !== "object" || Array.isArray(p) || typeof p.include !== "string") return;
      const from = typeof p.from === "string" ? p.from : "";
      const root = within(dir, from, file, lineOf(["tool", "poetry", "packages", i]), c);
      if (root === undefined) return;
      c.roots.push({ dir: root, via: `${posix.basename(file)} [tool.poetry.packages]` });
      const top = topLevel(p.include.replace(/\.py$/, "").replace(/\//g, "."));
      if (top !== undefined) c.packages.push(top);
    });
  }
  const groups: Array<[readonly (string | number)[], TomlTable | undefined, string]> = [
    [["tool", "poetry", "dependencies"], table(poetry, "dependencies"), "main"],
    [["tool", "poetry", "dev-dependencies"], table(poetry, "dev-dependencies"), "group:dev"],
  ];
  for (const [name, group] of entries(table(poetry, "group"))) {
    if (typeof group === "object" && !Array.isArray(group)) {
      groups.push([["tool", "poetry", "group", name, "dependencies"], table(group, "dependencies"), `group:${name}`]);
    }
  }
  for (const [path, deps, scope] of groups) {
    for (const [name, value] of entries(deps)) {
      if (name.toLowerCase() === "python") continue;
      c.dependencies.push(poetryDependency(name, value, scope, file, lineOf([...path, name])));
    }
  }
}

/** A Poetry dependency: `"^1.2"`, `{ version, extras, markers }`, a path/git/url table, or a list of constraints. */
function poetryDependency(name: string, value: TomlValue, scope: string, file: string, line: number): PythonDependency {
  const base = dependencyOf({ name, extras: [], spec: "" }, scope, file, line);
  if (typeof value === "string") return { ...base, version: { resolved: true, value } };
  if (Array.isArray(value)) return { ...base, version: { resolved: false, reason: "several constraints" } };
  if (typeof value !== "object") return base;
  const extras = stringList(value.extras);
  const marker = typeof value.markers === "string" ? value.markers : undefined;
  const source = ["path", "git", "url"].find((k) => typeof value[k] === "string");
  const version: PythonDependency["version"] =
    typeof value.version === "string"
      ? { resolved: true, value: value.version }
      : source
        ? { resolved: false, reason: `${source} dependency` }
        : base.version;
  return { ...base, version, ...(extras.length > 0 && { extras }), ...(marker !== undefined && { marker }) };
}

function readSetuptools(dir: string, file: string, st: TomlTable | undefined, lineOf: LineOf, c: Collected): void {
  if (!st) return;
  packageDirs(dir, file, "[tool.setuptools.package-dir]", entries(table(st, "package-dir")), (k) => lineOf(["tool", "setuptools", "package-dir", k]), c);
  const packages = st.packages;
  if (Array.isArray(packages)) {
    for (const p of stringList(packages)) {
      const top = topLevel(p);
      if (top !== undefined) c.packages.push(top);
    }
  } else if (typeof packages === "object") {
    const find = table(packages, "find");
    if (find) {
      const where = find.where === undefined ? ["."] : stringList(find.where);
      for (const w of where) {
        const root = within(dir, w, file, lineOf(["tool", "setuptools", "packages", "find", "where"]), c);
        if (root !== undefined) c.roots.push({ dir: root, via: `${posix.basename(file)} [tool.setuptools.packages.find]` });
      }
    }
  }
}

function readHatch(dir: string, file: string, wheel: TomlTable | undefined, lineOf: LineOf, c: Collected): void {
  if (!wheel) return;
  const via = `${posix.basename(file)} [tool.hatch.build.targets.wheel]`;
  stringList(wheel.packages).forEach((p, i) => {
    const path = within(dir, p, file, lineOf(["tool", "hatch", "build", "targets", "wheel", "packages", i]), c);
    if (path === undefined) return;
    c.roots.push({ dir: dirOf(path), via });
    c.packages.push(posix.basename(path));
  });
  const sources = wheel.sources;
  if (Array.isArray(sources)) {
    // A list of prefixes to strip: each is a root.
    stringList(sources).forEach((s, i) => {
      const root = within(dir, s, file, lineOf(["tool", "hatch", "build", "targets", "wheel", "sources", i]), c);
      if (root !== undefined) c.roots.push({ dir: root, via });
    });
  } else if (typeof sources === "object") {
    // Prefix → replacement: `"src" = ""` is a root; `"lib/pkg" = "pkg"` maps one package.
    for (const [from, to] of entries(sources)) {
      if (typeof to !== "string") continue;
      const root = within(dir, from, file, lineOf(["tool", "hatch", "build", "targets", "wheel", "sources", from]), c);
      if (root === undefined) continue;
      const pkg = to.replace(/\/+$/, "").replace(/\//g, ".");
      c.roots.push({ dir: root, ...(pkg !== "" && { package: pkg }), via });
    }
  }
}

// ── setup.cfg ────────────────────────────────────────────────────────────

function readSetupCfg(dir: string, file: string, text: string, c: Collected): void {
  const ini = parseIni(text);
  c.notices.push(...ini.notices.map((n) => n.replace(/^line (\d+): /, `${file}:$1: `)));
  const metadata = ini.sections.get("metadata");
  const options = ini.sections.get("options");
  const name = metadata?.get("name")?.value;
  if (name) c.names.push(name);

  const packageDir = options?.get("package_dir");
  if (packageDir) {
    const pairs: Array<[string, string, number]> = [];
    for (const { text: entry, line } of packageDir.lines) {
      const eq = entry.indexOf("=");
      if (eq < 0) c.notices.push(`${file}:${line}: package_dir entry is not 'package = dir'`);
      else pairs.push([entry.slice(0, eq).trim(), entry.slice(eq + 1).trim(), line]);
    }
    packageDirs(
      dir,
      file,
      "[options] package_dir",
      pairs.map(([k, v]) => [k, v]),
      (k) => pairs.find(([p]) => p === k)?.[2] ?? packageDir.line,
      c,
    );
  }

  const packages = options?.get("packages");
  if (packages) {
    const value = packages.value.trim();
    if (value === "find:" || value === "find_namespace:") {
      const find = ini.sections.get("options.packages.find");
      const where = find?.get("where");
      const dirs = where ? listValue(where).map((l) => l.text) : ["."];
      for (const w of dirs) {
        const root = within(dir, w, file, where?.line ?? packages.line, c);
        if (root !== undefined) c.roots.push({ dir: root, via: `${posix.basename(file)} [options.packages.find]` });
      }
    } else {
      for (const { text: p } of listValue(packages)) {
        const top = topLevel(p);
        if (top !== undefined) c.packages.push(top);
      }
    }
  }

  const requires = options?.get("install_requires");
  if (requires) cfgRequirements(requires, "main", file, c);
  for (const [extra, value] of ini.sections.get("options.extras_require") ?? []) cfgRequirements(value, `optional:${extra}`, file, c);
}

/** A setup.cfg list: one item per line, or comma-separated on one line. */
function listValue(v: IniValue): { text: string; line: number }[] {
  return v.lines.flatMap(({ text, line }) =>
    text
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "")
      .map((t) => ({ text: t, line })),
  );
}

function cfgRequirements(v: IniValue, scope: string, file: string, c: Collected): void {
  // One requirement per line; a single-line value may be comma-separated, but a specifier list contains commas too, so only split when every part parses.
  for (const { text, line } of v.lines) {
    const whole = requirementDependency(text, scope, file, line);
    const parts = text.split(",").map((p) => p.trim()).filter((p) => p !== "");
    const split = parts.map((p) => requirementDependency(p, scope, file, line));
    if (whole && (parts.length === 1 || split.some((d) => d === undefined))) c.dependencies.push(whole);
    else if (split.length > 0 && split.every((d) => d !== undefined)) c.dependencies.push(...(split as PythonDependency[]));
    else c.notices.push(`${file}:${line}: not a requirement: ${text}`);
  }
}

// ── setup.py ─────────────────────────────────────────────────────────────

function readSetupPy(dir: string, file: string, text: string, c: Collected): void {
  const call = readSetupCall(text);
  if ("notice" in call) {
    c.notices.push(`${file}: ${call.notice}`);
    return;
  }
  if (call.spreads) c.notices.push(`${file}:${call.line}: setup() takes **kwargs; arguments not written literally are not read`);
  const arg = (key: string): SetupArgument | undefined => {
    const a = call.keywords.get(key);
    if (a?.value === NON_LITERAL) {
      c.notices.push(`${file}:${a.line}: ${key} is not a literal; not read`);
      return undefined;
    }
    return a;
  };

  const name = arg("name");
  if (typeof name?.value === "string") c.names.push(name.value);

  const packageDir = arg("package_dir");
  if (packageDir && isDict(packageDir.value)) {
    const pairs = packageDir.value.entries.filter((e): e is { key: string; value: string; line: number } => typeof e.key === "string" && typeof e.value === "string");
    packageDirs(dir, file, "package_dir", pairs.map((e) => [e.key, e.value]), (k) => pairs.find((e) => e.key === k)?.line ?? packageDir.line, c);
  }

  const packages = arg("packages");
  if (packages) {
    const v = packages.value;
    if (Array.isArray(v)) {
      for (const p of v) {
        const top = typeof p === "string" ? topLevel(p) : undefined;
        if (top !== undefined) c.packages.push(top);
      }
    } else if (isFind(v)) {
      if (v.where === NON_LITERAL) c.notices.push(`${file}:${packages.line}: find_packages where is not a literal; not read`);
      else {
        const root = within(dir, v.where ?? ".", file, packages.line, c);
        if (root !== undefined) c.roots.push({ dir: root, via: `${posix.basename(file)} find_packages` });
      }
    }
  }

  const requires = arg("install_requires");
  if (requires) literalRequirements(requires.value, requires.itemLines, requires.line, "main", file, c);
  const extras = arg("extras_require");
  if (extras && isDict(extras.value)) {
    for (const e of extras.value.entries) {
      if (typeof e.key === "string") literalRequirements(e.value, [], e.line, `optional:${e.key}`, file, c);
    }
  }
}

function literalRequirements(value: PyLiteral | typeof NON_LITERAL, itemLines: readonly number[], line: number, scope: string, file: string, c: Collected): void {
  const items = typeof value === "string" ? value.split("\n") : Array.isArray(value) ? value : [];
  items.forEach((item, i) => {
    if (typeof item !== "string" || item.trim() === "") return;
    const at = itemLines[i] ?? line;
    const dep = requirementDependency(item, scope, file, at);
    if (dep) c.dependencies.push(dep);
    else c.notices.push(`${file}:${at}: not a requirement: ${item}`);
  });
}

function isDict(v: PyLiteral | typeof NON_LITERAL): v is Extract<PyLiteral, { kind: "dict" }> {
  return typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "dict";
}

function isFind(v: PyLiteral | typeof NON_LITERAL): v is Extract<PyLiteral, { kind: "find_packages" }> {
  return typeof v === "object" && !Array.isArray(v) && "kind" in v && v.kind === "find_packages";
}

// ── Shared ───────────────────────────────────────────────────────────────

/** setuptools `package_dir` / `package-dir`: `"" → dir` is a root holding packages; `pkg → dir` maps one package. */
function packageDirs(
  dir: string,
  file: string,
  what: string,
  pairs: Iterable<[string, TomlValue]>,
  lineOf: (key: string) => number,
  c: Collected,
): void {
  for (const [pkg, target] of pairs) {
    if (typeof target !== "string") continue;
    const root = within(dir, target, file, lineOf(pkg), c);
    if (root === undefined) continue;
    c.roots.push({ dir: root, ...(pkg !== "" && { package: pkg }), via: `${posix.basename(file)} ${what}` });
  }
}

/** `rel` resolved against the project directory, or undefined (with a notice) when it leaves the repository. */
function within(dir: string, rel: string, file: string, line: number, c: Collected): string | undefined {
  if (posix.isAbsolute(rel) || rel.includes("\\")) {
    c.notices.push(`${file}:${line}: ${rel} is not a relative path; not read`);
    return undefined;
  }
  const joined = posix.normalize(posix.join(dir === "" ? "." : dir, rel));
  if (joined === ".." || joined.startsWith("../")) {
    c.notices.push(`${file}:${line}: ${rel} leaves the repository; not read`);
    return undefined;
  }
  return joined === "." ? "" : joined.replace(/\/$/, "");
}

/** The first dotted segment of a package name, or undefined when it is not an identifier (a glob, a path). */
function topLevel(pkg: string): string | undefined {
  const top = pkg.trim().split(".")[0];
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(top) ? top : undefined;
}

function table(t: TomlTable | undefined, key: string): TomlTable | undefined {
  const v = t && Object.hasOwn(t, key) ? t[key] : undefined;
  return typeof v === "object" && !Array.isArray(v) ? v : undefined;
}

function entries(t: TomlTable | undefined): [string, TomlValue][] {
  return t ? Object.entries(t) : [];
}

function stringList(v: TomlValue | undefined): string[] {
  if (typeof v === "string") return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function dirOf(file: string): string {
  const d = posix.dirname(file);
  return d === "." ? "" : d;
}

/** The project a requirements file belongs to: `requirements*.txt` → its directory; `requirements/*.txt` → the directory above. */
function requirementsOwner(file: string): string | undefined {
  const base = posix.basename(file);
  if (!base.endsWith(".txt")) return undefined;
  const dir = dirOf(file);
  if (/^requirements.*\.txt$/i.test(base)) return dir;
  if (posix.basename(dir) === "requirements") return dirOf(dir);
  return undefined;
}

/** A glob over directory paths: `*` and `?` within a segment, `**` across segments, `[…]` classes. */
function globRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i++;
      if (pattern[i + 1] === "/") i++;
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) re += "\\[";
      else {
        re += `[${pattern.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else re += ch.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${re.replace(/\/$/, "")}$`);
}

function uniqueRoots(roots: readonly PythonSourceRoot[]): PythonSourceRoot[] {
  const seen = new Map<string, PythonSourceRoot>();
  for (const r of roots) {
    const key = `${r.dir}\u0000${r.package ?? ""}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()].sort((a, b) => a.dir.localeCompare(b.dir) || (a.package ?? "").localeCompare(b.package ?? ""));
}

function compareDeps(a: PythonDependency, b: PythonDependency): number {
  return a.artifact.localeCompare(b.artifact) || a.file.localeCompare(b.file) || a.line - b.line;
}
