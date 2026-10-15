/**
 * Python import resolver: turns each file's written imports into edges to
 * project files and into external packages.
 *
 * {@link pythonResolver.forProject} reads the projects lang-kit's Python build
 * readers find (`pyproject.toml`, `setup.cfg`, `setup.py`, requirements) in the
 * directories that hold the pack's files; `prepare` then resolves every file.
 * Source roots are the projects' declared or inferred roots; a repository
 * with no project has one, its root. A file resolves against its own
 * project's roots (the deepest project above it) first, then its project's
 * directory (pytest puts it on the path, so `tests.helpers` resolves), then
 * the other projects' roots.
 *
 * Within a root a module `a.b` is, in Python's order, the package
 * `a/b/__init__.py`, the module `a/b.py`, or a namespace package: a
 * directory `a/b` holding Python files and no `__init__.py` (PEP 420). A
 * `.pyi` stub is the target only when no `.py` sits beside it. An import of
 * a namespace package itself is resolved to its directory, which the imports
 * schema has no place for, so it gives no edge.
 *
 * - `import a.b.c` targets `a.b.c`, symbol `*`.
 * - `from a.b import c` targets the submodule `a.b.c` (symbol `*`) when it
 *   exists, otherwise `a.b` with symbol `c`; `from a import *` targets `a`.
 * - A relative import climbs from the importing file's package (its
 *   directory; an `__init__.py` is its package itself). Climbing past the
 *   file's source root leaves it unresolved, with a notice.
 * - An import whose top-level module is the project's but whose module is
 *   not is unresolved, unless the deepest part the project has is a
 *   namespace package: another distribution may supply the rest
 *   (poetry-core's `poetry.core` under poetry's `src/poetry`), so it is external.
 * - An import found under no root is external, named by its top-level
 *   module. Python 3.13's stdlib modules are `stdlib:<name>`
 *   ({@link PYTHON_STDLIB_MODULES}); any other is matched to a declared
 *   dependency only when its PEP 503-normalised name equals the
 *   distribution's (`yaml` never matches `PyYAML`). A top-level name that is
 *   only a namespace directory in the project loses to a stdlib module or a
 *   declared dependency of that name, as it does to a regular package in Python.
 * - A target reached only by `if TYPE_CHECKING:` imports is `typeOnly`; an
 *   ImportError-guarded import is an ordinary edge.
 *
 * Dynamic imports are never resolved (see `python-notices.ts`).
 *
 * @module lang-python/python-resolver
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizePythonName,
  pythonProjectsFrom,
  type ExternalModule,
  type FileReferences,
  type PythonDependency,
  type PythonProject,
  type ReadRepoText,
  type WrittenImport,
} from "@n-dx/lang-kit";
import type { PackResolver, PackSourceFile, PreparedResolver } from "@n-dx/lang-runtime";
import { readWrittenImports } from "./python-imports.js";
import { PYTHON_STDLIB_MODULES } from "./python-stdlib.js";

// ── Paths ───────────────────────────────────────────────────────────────────

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

const joinPath = (...parts: string[]): string => parts.filter((p) => p !== "").join("/");

/** `dir` is `ancestor` or lies beneath it. */
const under = (dir: string, ancestor: string): boolean => ancestor === "" || dir === ancestor || dir.startsWith(`${ancestor}/`);

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ── Project facts ───────────────────────────────────────────────────────────

/**
 * The Python projects around `files`: every file in each directory that holds
 * one of them or lies above one (and in a `requirements/` directory there) is
 * offered to lang-kit's readers, which find the projects in that list.
 * Nothing else of the project is walked.
 */
export async function readPythonResolveProjects(projectDir: string, files: readonly string[]): Promise<PythonProject[]> {
  const dirs = new Set<string>([""]);
  for (const file of files) {
    for (let dir = dirOf(file); dir !== "" && !dirs.has(dir); dir = dirOf(dir)) dirs.add(dir);
  }
  const listed = new Set(files);
  const list = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(projectDir, dir), { withFileTypes: true });
    } catch {
      return; // an unreadable directory holds no build file the readers could read
    }
    for (const entry of entries) {
      const path = joinPath(dir, entry.name);
      if (entry.isFile()) listed.add(path);
      else if (entry.isDirectory() && entry.name === "requirements") await list(path);
    }
  };
  for (const dir of [...dirs].sort()) await list(dir);
  const read: ReadRepoText = async (path) => {
    try {
      return await readFile(join(projectDir, path), "utf8");
    } catch {
      return undefined; // the readers turn an unreadable file into a notice
    }
  };
  return pythonProjectsFrom([...listed].sort(), read);
}

// ── Outcomes ────────────────────────────────────────────────────────────────

/** Why an import was not resolved. */
export type UnresolvedReason =
  /** A relative import whose dots climb past the file's source root. */
  | "past-root"
  /** A relative import whose module is not a project file. */
  | "relative-not-found"
  /** An absolute import whose top-level module is the project's, but whose module is not. */
  | "internal-not-found";

/** What one written import resolved to. */
export type ImportOutcome =
  | { readonly kind: "internal"; readonly targets: readonly string[] }
  /** A namespace package, resolved to its directory: no edge. */
  | { readonly kind: "namespace"; readonly dir: string }
  | { readonly kind: "stdlib"; readonly module: string }
  /** `dependency` is the declared distribution it matched, if any. */
  | { readonly kind: "external"; readonly module: string; readonly dependency?: string }
  | { readonly kind: "unresolved"; readonly reason: UnresolvedReason };

export interface ResolvedImport {
  readonly written: WrittenImport;
  readonly outcome: ImportOutcome;
}

// ── Index ───────────────────────────────────────────────────────────────────

/** A directory modules are imported from; `package` when the directory is that one package. */
interface Root {
  readonly dir: string;
  readonly package?: string;
}

type Lookup = { readonly file: string } | { readonly namespace: string };

/** A module found at `path` (a project path without extension). */
interface Located {
  readonly path: string;
  readonly found: Lookup;
}

class Index {
  private readonly files: ReadonlySet<string>;
  /** Directories holding a Python file at any depth. */
  private readonly dirs = new Set<string>();
  /** Deepest project first. */
  private readonly projects: readonly PythonProject[];
  private readonly rootsCache = new Map<string, readonly Root[]>();
  private readonly allDependencies: readonly PythonDependency[];

  constructor(projects: readonly PythonProject[], paths: readonly string[]) {
    this.files = new Set(paths);
    for (const path of paths) {
      for (let dir = dirOf(path); dir !== "" && !this.dirs.has(dir); dir = dirOf(dir)) this.dirs.add(dir);
    }
    this.projects = [...projects].sort((a, b) => b.dir.length - a.dir.length || compare(a.dir, b.dir));
    this.allDependencies = projects.flatMap((p) => p.dependencies);
  }

  projectOf(file: string): PythonProject | undefined {
    const dir = dirOf(file);
    return this.projects.find((p) => under(dir, p.dir));
  }

  /**
   * The file's own project's roots, then its project directory (where a
   * test runner such as pytest puts the project's `tests` package), then
   * every other project's roots; the repository root when there is no project.
   */
  rootsFor(file: string): readonly Root[] {
    const own = this.projectOf(file);
    const key = own?.dir ?? "\0";
    const cached = this.rootsCache.get(key);
    if (cached) return cached;
    let roots: Root[];
    if (this.projects.length === 0) {
      roots = [{ dir: "" }];
    } else {
      const byDir = [...this.projects].reverse();
      const ordered = own ? [own, ...byDir.filter((p) => p !== own)] : byDir;
      const seen = new Set<string>();
      roots = [];
      const add = (root: Root): void => {
        const id = `${root.dir}\0${root.package ?? ""}`;
        if (seen.has(id)) return;
        seen.add(id);
        roots.push(root.package === undefined ? { dir: root.dir } : { dir: root.dir, package: root.package });
      };
      for (const project of ordered) {
        for (const root of project.sourceRoots) add(root);
        if (project === own) add({ dir: own.dir });
      }
    }
    this.rootsCache.set(key, roots);
    return roots;
  }

  /** The module or package at `path`, in Python's order: package, module, namespace package. */
  lookup(path: string): Lookup | undefined {
    if (path === "") return undefined; // the repository root is not a package
    for (const file of [`${path}/__init__.py`, `${path}/__init__.pyi`, `${path}.py`, `${path}.pyi`]) {
      if (this.files.has(file)) return { file };
    }
    return this.dirs.has(path) ? { namespace: path } : undefined;
  }

  /** `segments` as a path under `root`; undefined when the root is one package and the module is not in it. */
  private pathIn(root: Root, segments: readonly string[]): string | undefined {
    if (root.package === undefined) return joinPath(root.dir, ...segments);
    const head = root.package.split(".");
    if (head.some((s, i) => segments[i] !== s)) return undefined;
    return joinPath(root.dir, ...segments.slice(head.length));
  }

  /** The first root holding the module as a file; else the first holding it as a namespace package. */
  resolveAbsolute(roots: readonly Root[], segments: readonly string[]): Located | undefined {
    let namespace: Located | undefined;
    for (const root of roots) {
      const path = this.pathIn(root, segments);
      if (path === undefined) continue;
      const found = this.lookup(path);
      if (found && "file" in found) return { path, found };
      if (found) namespace ??= { path, found };
    }
    return namespace;
  }

  /**
   * Every prefix of `segments` the project has, from the top-level module
   * down, is a namespace package, so another distribution may supply the
   * rest. A namespace directory inside a regular package cannot be extended:
   * the package's `__path__` is its one directory.
   */
  missingBelowNamespace(roots: readonly Root[], segments: readonly string[]): boolean {
    let any = false;
    for (let n = 1; n < segments.length; n++) {
      const prefix = this.resolveAbsolute(roots, segments.slice(0, n));
      if (!prefix) break;
      if (!("namespace" in prefix.found)) return false;
      any = true;
    }
    return any;
  }

  /** The declared distribution an import's top-level module names, by PEP 503 name; own project first. */
  dependencyFor(file: string, top: string): PythonDependency | undefined {
    const name = normalizePythonName(top);
    const own = this.projectOf(file)?.dependencies ?? [];
    return own.find((d) => d.artifact === name) ?? this.allDependencies.find((d) => d.artifact === name);
  }
}

// ── Per-file resolution ─────────────────────────────────────────────────────

class Collector {
  private readonly files = new Map<string, { symbols: Set<string>; runtime: boolean }>();
  private readonly external = new Map<string, { symbols: Set<string>; module?: ExternalModule }>();

  constructor(private readonly self: string) {}

  file(to: string, symbol: string, typeOnly: boolean): void {
    if (to === this.self) return;
    let entry = this.files.get(to);
    if (!entry) this.files.set(to, (entry = { symbols: new Set(), runtime: false }));
    entry.symbols.add(symbol);
    if (!typeOnly) entry.runtime = true;
  }

  externalPackage(pkg: string, symbols: readonly string[], module: ExternalModule | undefined): void {
    let entry = this.external.get(pkg);
    if (!entry) this.external.set(pkg, (entry = { symbols: new Set(), ...(module && { module }) }));
    for (const s of symbols) entry.symbols.add(s);
  }

  result(written: readonly WrittenImport[]): FileReferences {
    return {
      files: [...this.files.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([to, { symbols, runtime }]) => ({ to, symbols: [...symbols].sort(compare), ...(!runtime && { typeOnly: true as const }) })),
      external: [...this.external.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([pkg, { symbols, module }]) => ({ package: pkg, symbols: [...symbols].sort(compare), ...(module && { module }) })),
      written,
    };
  }
}

/** Names that are submodules of the module become their own targets; the rest are attributes of the module. */
function targetsOf(index: Index, { path, found }: Located, names: readonly string[]): Array<{ to: string; symbol: string }> {
  const out: Array<{ to: string; symbol: string }> = [];
  if (names.length === 0 || names.includes("*")) {
    if ("file" in found) out.push({ to: found.file, symbol: "*" });
    return out;
  }
  for (const name of names) {
    const sub = index.lookup(joinPath(path, name));
    if (sub && "file" in sub) out.push({ to: sub.file, symbol: "*" });
    else if ("file" in found) out.push({ to: found.file, symbol: name });
  }
  return out;
}

/**
 * `base` is a package below one of the roots holding the file. A plain root's
 * own directory is not a package; a package root's directory is the package.
 * Any such root will do: a project's directory can be both its own root and
 * a package under the repository root (`python -m script.check_requirements`).
 */
function insideARoot(roots: readonly Root[], file: string, base: string): boolean {
  const dir = dirOf(file);
  return roots.some(
    (root) => under(dir, root.dir) && (root.package === undefined ? base !== root.dir && under(base, root.dir) : under(base, root.dir)),
  );
}

/** Where a relative import's module is, or why it is not resolved. */
function locateRelative(index: Index, file: string, specifier: string): Located | UnresolvedReason {
  const dots = specifier.length - specifier.replace(/^\.+/, "").length;
  const rest = specifier.slice(dots);
  let base = dirOf(file);
  for (let i = 1; i < dots; i++) {
    if (base === "") return "past-root";
    base = dirOf(base);
  }
  const roots = index.rootsFor(file);
  // A file under no root (a script beside a src layout) may climb as far as the repository root.
  if (roots.some((root) => under(dirOf(file), root.dir)) ? !insideARoot(roots, file, base) : base === "") return "past-root";
  const path = joinPath(base, ...(rest === "" ? [] : rest.split(".")));
  const found = index.lookup(path);
  return found ? { path, found } : "relative-not-found";
}

/** Record the import's edges and externals in `out`, and say what it resolved to. */
function resolveImport(index: Index, file: string, w: WrittenImport, out: Collector): ImportOutcome {
  const internal = (located: Located): ImportOutcome => {
    const targets = targetsOf(index, located, w.names);
    for (const t of targets) out.file(t.to, t.symbol, w.guard === "type-checking");
    if (targets.length === 0) return { kind: "namespace", dir: located.path };
    return { kind: "internal", targets: [...new Set(targets.map((t) => t.to))] };
  };
  if (w.specifier.startsWith(".")) {
    const located = locateRelative(index, file, w.specifier);
    return typeof located === "string" ? { kind: "unresolved", reason: located } : internal(located);
  }

  const segments = w.specifier.split(".");
  const top = segments[0]!;
  const roots = index.rootsFor(file);
  const topFound = index.resolveAbsolute(roots, [top]);
  const dependency = index.dependencyFor(file, top);
  // A top-level name that is only namespace directories loses to a regular stdlib module or installed distribution.
  const shadowed =
    topFound !== undefined && "namespace" in topFound.found && (PYTHON_STDLIB_MODULES.has(top) || dependency !== undefined);
  if (topFound && !shadowed) {
    const located = index.resolveAbsolute(roots, segments);
    if (located) return internal(located);
    // Below a namespace package the module may be another distribution's portion (poetry-core's `poetry.core`).
    if (!index.missingBelowNamespace(roots, segments)) return { kind: "unresolved", reason: "internal-not-found" };
  }

  const symbols = w.names.length === 0 ? ["*"] : w.names;
  if (PYTHON_STDLIB_MODULES.has(top)) {
    out.externalPackage(`stdlib:${top}`, symbols, undefined);
    return { kind: "stdlib", module: top };
  }
  const module: ExternalModule | undefined = dependency && {
    path: dependency.artifact,
    ...(dependency.version.resolved && { version: dependency.version.value }),
  };
  out.externalPackage(top, symbols, module);
  return dependency ? { kind: "external", module: top, dependency: dependency.artifact } : { kind: "external", module: top };
}

// ── Resolver ────────────────────────────────────────────────────────────────

/** How many notices name a location before the rest are counted. */
const NOTICE_LOCATIONS = 5;

/** The notice for relative imports that climb past their source root; undefined when there are none. */
export function pastRootNotice(found: ReadonlyArray<{ readonly path: string; readonly written: WrittenImport }>): string | undefined {
  if (found.length === 0) return undefined;
  const where = found.slice(0, NOTICE_LOCATIONS).map(({ path, written }) => `${path}:${written.position.line} (${written.specifier})`);
  const more = found.length > NOTICE_LOCATIONS ? `, and ${found.length - NOTICE_LOCATIONS} more` : "";
  const subject =
    found.length === 1
      ? "1 relative import climbs past its source root and is not resolved"
      : `${found.length} relative imports climb past their source root and are not resolved`;
  return `Python: ${subject}: ${where.join(", ")}${more}.`;
}

/** A prepared resolver that also keeps what each import resolved to, for the corpus report. */
export interface PreparedPythonResolver extends PreparedResolver {
  /** Each written import of a prepared file with its outcome, in document order. */
  outcomes(fromFile: string): readonly ResolvedImport[];
}

/** Resolve every file of a project at once. */
export function preparePythonImports(
  projects: readonly PythonProject[],
  files: readonly PackSourceFile[],
  unparsed: readonly string[] = [],
): PreparedPythonResolver {
  const index = new Index(projects, [...files.map((f) => f.path), ...unparsed]);
  const refs = new Map<string, FileReferences>();
  const outcomes = new Map<string, ResolvedImport[]>();
  const pastRoot: Array<{ path: string; written: WrittenImport }> = [];
  for (const file of files) {
    const written = readWrittenImports(file);
    const out = new Collector(file.path);
    const resolved = written.map((w) => ({ written: w, outcome: resolveImport(index, file.path, w, out) }));
    for (const r of resolved) {
      if (r.outcome.kind === "unresolved" && r.outcome.reason === "past-root") pastRoot.push({ path: file.path, written: r.written });
    }
    refs.set(file.path, out.result(written));
    outcomes.set(file.path, resolved);
  }
  const notice = pastRootNotice(pastRoot);
  return {
    resolve: (fromFile) => refs.get(fromFile) ?? { files: [], external: [] },
    outcomes: (fromFile) => outcomes.get(fromFile) ?? [],
    notices: () => (notice === undefined ? [] : [notice]),
  };
}

function createPythonResolver(projects: readonly PythonProject[]): PackResolver {
  return {
    forProject: async (projectDir, files) => createPythonResolver(await readPythonResolveProjects(projectDir, files)),
    prepare: (files, unparsed) => preparePythonImports(projects, files, unparsed),
  };
}

/**
 * The Python resolver. Without {@link PackResolver.forProject} it knows no
 * project, so the repository root is the one source root.
 */
export const pythonResolver: PackResolver = createPythonResolver([]);
