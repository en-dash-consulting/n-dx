/**
 * Go reference resolver: turns the Go pack's import captures into edges to
 * project packages and external packages.
 *
 * {@link goResolver.forProject} reads the project's `go.mod`, `go.work` and
 * `vendor/modules.txt` files (in memory only); `prepare` then indexes the
 * package directories. Each file resolves in the scope of its module — the
 * nearest `go.mod` above it — or, when a `go.work` uses that module, of the
 * whole workspace. An import path resolves, longest prefix first, through:
 * - the module path of the file's module, or of every module the workspace uses;
 * - `replace` directives whose target is a directory inside the project
 *   (the workspace's override its modules');
 * otherwise it is stdlib (first segment without a dot, `isGoStdlibPath`) or
 * third-party. A third-party package is attributed to its module and version
 * from `vendor/modules.txt` when vendored, else from the longest matching
 * `require`, with versioned `replace` targets applied.
 *
 * Edges follow the regex parser (`analyzers/go-imports.ts`): an import names
 * a package, so the edge targets the package directory, and the zones phase
 * expands it to the files beneath. Symbols are the import's alias, else `*`;
 * external symbols are always `*`, and stdlib packages are `stdlib:<path>`.
 * Deliberate differences from the regex parser:
 * - project modules are matched before the stdlib check, so a module path
 *   without a dot (`module myapp`) is internal, not stdlib;
 * - `go.work` modules and local replaces are internal, not third-party;
 * - nested modules resolve against their own `go.mod`, not the root's;
 * - a required module whose path extends a project module's (`require
 *   gitea.dev/actionslib` in `module gitea.dev`) is third-party, as in Go's
 *   longest-module-prefix rule, where the regex parser emits an edge to a
 *   project directory that does not exist;
 * - an import inside a project module whose directory holds no inventoried
 *   .go file (parsed, or passed as unparsed: oversized, unreadable), such as
 *   a local replace into a `third_party/`, `build/` or gitignored directory
 *   the inventory skips, is an external package attributed to its `require`.
 *   The regex parser keeps it as an external too when sourcevision hands it
 *   the inventory (`targetExists`), but attributes it to no module (or, for a
 *   replaced module, emits an external by the replace alone);
 * - the module's root package (directory "") targets its non-test files,
 *   because an edge to "" matches no file downstream.
 *
 * @module lang-go/go-resolver
 */

import { posix } from "node:path";
import {
  goConfig,
  isGoStdlibPath,
  readGoBuildModels,
  readGoVendorModules,
  readGoWorkFiles,
  type GoModuleBuild,
  type GoReplace,
  type GoVendoredModule,
  type GoWorkFacts,
} from "@n-dx/lang-kit";
import type {
  Capture,
  ExternalModule,
  FileReferences,
  PackResolver,
  PackSourceFile,
  PreparedResolver,
  SourcePosition,
} from "@n-dx/lang-runtime";

// ── Project facts ───────────────────────────────────────────────────────────

/** The build files resolution reads, held in memory. */
export interface GoProject {
  readonly modules: readonly GoModuleBuild[];
  readonly workspaces: readonly GoWorkFacts[];
  /** Module directory → the modules vendored there. */
  readonly vendored: ReadonlyMap<string, readonly GoVendoredModule[]>;
}

const EMPTY_PROJECT: GoProject = { modules: [], workspaces: [], vendored: new Map() };

/** Read every `go.mod`, `go.work` and `vendor/modules.txt` of a project. */
export async function readGoProject(projectDir: string): Promise<GoProject> {
  const modules = await readGoBuildModels(projectDir);
  const workspaces = await readGoWorkFiles(projectDir);
  const vendored = new Map<string, readonly GoVendoredModule[]>();
  for (const { dir } of modules) {
    const list = await readGoVendorModules(projectDir, dir);
    if (list.length > 0) vendored.set(dir, list);
  }
  return { modules, workspaces, vendored };
}

// ── Facts read from one file's captures ─────────────────────────────────────

interface GoImport {
  readonly path: string;
  /** The named alias; absent for a plain, dot or blank import. */
  readonly alias?: string;
}

function before(a: SourcePosition, b: SourcePosition): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

/** `inner` lies within `outer` (bounds inclusive). */
function within(inner: Capture, outer: Capture): boolean {
  return !before(inner.start, outer.start) && !before(outer.end, inner.end);
}

function readImports(file: PackSourceFile): GoImport[] {
  const captures = file.captures["imports"] ?? [];
  return captures
    .filter((c) => c.name === "import.spec")
    .flatMap((spec): GoImport[] => {
      const inside = captures.filter((c) => c !== spec && within(c, spec));
      const name = inside.find((c) => c.name === "import.name");
      if (!name) return [];
      const alias = inside.find((c) => c.name === "import.alias");
      return [{ path: name.text, ...(alias && { alias: alias.text }) }];
    });
}

// ── Scopes ──────────────────────────────────────────────────────────────────

/** An import-path prefix that maps to a project directory ("" is the project root). */
interface Root {
  readonly path: string;
  readonly dir: string;
}

/** What one module's files can see. */
interface Scope {
  /** Longest path first. */
  readonly roots: readonly Root[];
  /** Required module path → module and effective version. */
  readonly requires: ReadonlyMap<string, ExternalModule>;
  /** Vendored package import path → its module. */
  readonly vendored: ReadonlyMap<string, ExternalModule>;
}

const EMPTY_SCOPE: Scope = { roots: [], requires: new Map(), vendored: new Map() };

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

/** `dir` is `ancestor` or lies beneath it. */
const under = (dir: string, ancestor: string): boolean => ancestor === "" || dir === ancestor || dir.startsWith(`${ancestor}/`);

/** `rel` (as written in a build file in `base`) as a project directory; undefined when it leaves the project. */
function directoryInProject(base: string, rel: string): string | undefined {
  if (posix.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel)) return undefined;
  const joined = posix.normalize(posix.join(base, rel.replace(/\\/g, "/")));
  if (joined === ".." || joined.startsWith("../")) return undefined;
  return joined === "." ? "" : joined.replace(/\/$/, "");
}

const modulePath = (m: GoModuleBuild): string | undefined => m.goMod.module;

function buildScope(project: GoProject, module: GoModuleBuild): Scope {
  const workspace = workspaceOf(project, module);
  const members = workspace
    ? project.modules.filter((m) => workspace.use.includes(m.dir))
    : [module];

  // Replaces, highest precedence first: the workspace's, then each member's.
  const replaces: Array<{ readonly base: string; readonly replace: GoReplace }> = [
    ...(workspace ? workspace.facts.replaces.map((replace) => ({ base: workspace.dir, replace })) : []),
    ...members.flatMap((m) => m.goMod.replaces.map((replace) => ({ base: m.dir, replace }))),
  ];

  const roots = new Map<string, Root>();
  // Replaces are added first so they win a tie with a module path.
  for (const { base, replace } of replaces) {
    if (!replace.local || roots.has(replace.old.path)) continue;
    const dir = directoryInProject(base, replace.new.path);
    if (dir !== undefined) roots.set(replace.old.path, { path: replace.old.path, dir });
  }
  for (const m of members) {
    const path = modulePath(m);
    if (path !== undefined && !roots.has(path)) roots.set(path, { path, dir: m.dir });
  }

  const requires = new Map<string, ExternalModule>();
  for (const m of members) {
    for (const dep of m.dependencies) {
      const path = dep.group ? `${dep.group}/${dep.artifact}` : dep.artifact;
      if (requires.has(path)) continue;
      requires.set(path, { path, ...(dep.version.resolved && { version: dep.version.value }) });
    }
  }
  const originalVersions = new Map([...requires].map(([path, required]) => [path, required.version]));
  // A versioned replace supplies the code: report its version. Applied lowest
  // precedence first so the workspace's replace is the one that sticks.
  for (const { replace } of [...replaces].reverse()) {
    const required = requires.get(replace.old.path);
    if (replace.local || !required) continue;
    if (replace.old.version !== undefined && replace.old.version !== originalVersions.get(replace.old.path)) continue;
    requires.set(required.path, { path: required.path, ...(replace.new.version !== undefined && { version: replace.new.version }) });
  }

  const vendored = new Map<string, ExternalModule>();
  for (const v of project.vendored.get(module.dir) ?? []) {
    const attributed: ExternalModule = { path: v.path, ...(v.version !== undefined && { version: v.version }) };
    for (const pkg of v.packages) vendored.set(pkg, attributed);
  }

  return {
    roots: [...roots.values()].sort((a, b) => b.path.length - a.path.length),
    requires,
    vendored,
  };
}

/** The nearest `go.work` above the module that uses it, with its `use` entries as project directories. */
function workspaceOf(
  project: GoProject,
  module: GoModuleBuild,
): { readonly dir: string; readonly use: readonly string[]; readonly facts: GoWorkFacts } | undefined {
  let found: { dir: string; use: string[]; facts: GoWorkFacts } | undefined;
  for (const facts of project.workspaces) {
    const dir = dirOf(facts.file);
    if (!under(module.dir, dir) || (found && found.dir.length >= dir.length)) continue;
    const use = facts.use.flatMap((u) => {
      const resolved = directoryInProject(dir, u);
      return resolved === undefined ? [] : [resolved];
    });
    if (use.includes(module.dir)) found = { dir, use, facts };
  }
  return found;
}

// ── Per-file resolution ─────────────────────────────────────────────────────

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

class Collector {
  private readonly files = new Map<string, Set<string>>();
  private readonly external = new Map<string, { symbols: Set<string>; module?: ExternalModule }>();

  constructor(private readonly self: string) {}

  file(to: string, symbol: string): void {
    if (to === this.self) return;
    let set = this.files.get(to);
    if (!set) this.files.set(to, (set = new Set()));
    set.add(symbol);
  }

  externalPackage(pkg: string, module: ExternalModule | undefined): void {
    let entry = this.external.get(pkg);
    if (!entry) this.external.set(pkg, (entry = { symbols: new Set(), ...(module && { module }) }));
    entry.symbols.add("*");
  }

  result(): FileReferences {
    return {
      files: [...this.files.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([to, symbols]) => ({ to, symbols: [...symbols].sort(compare) })),
      external: [...this.external.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([pkg, { symbols, module }]) => ({ package: pkg, symbols: [...symbols].sort(compare), ...(module && { module }) })),
    };
  }
}

interface Index {
  /** Package directory → files directly in it. */
  readonly packages: ReadonlyMap<string, readonly string[]>;
  /** Scope per module directory; files outside every module use {@link EMPTY_SCOPE}. */
  scopeFor(file: string): Scope;
}

function buildIndex(project: GoProject, paths: readonly string[]): Index {
  const packages = new Map<string, string[]>();
  for (const path of paths) {
    const dir = dirOf(path);
    const list = packages.get(dir);
    if (list) list.push(path);
    else packages.set(dir, [path]);
  }
  // Deepest module first, so a file finds its nearest go.mod.
  const modules = [...project.modules].sort((a, b) => b.dir.length - a.dir.length);
  const scopes = new Map<string, Scope>();
  return {
    packages,
    scopeFor(file) {
      const dir = dirOf(file);
      const module = modules.find((m) => under(dir, m.dir));
      if (!module) return EMPTY_SCOPE;
      let scope = scopes.get(module.dir);
      if (!scope) scopes.set(module.dir, (scope = buildScope(project, module)));
      return scope;
    },
  };
}

/** The module an external package comes from: vendored list first, then the longest matching `require`. */
function attribute(scope: Scope, pkg: string): ExternalModule | undefined {
  const vendored = scope.vendored.get(pkg);
  if (vendored) return vendored;
  for (let path = pkg; path !== ""; path = dirOf(path)) {
    const required = scope.requires.get(path);
    if (required) return required;
  }
  return undefined;
}

const isTestFile = (path: string): boolean => goConfig.testFilePatterns.some((p) => p.test(path));

function resolveFile(index: Index, file: PackSourceFile): FileReferences {
  const out = new Collector(file.path);
  const scope = index.scopeFor(file.path);

  for (const imp of readImports(file)) {
    const root = scope.roots.find((r) => imp.path === r.path || imp.path.startsWith(`${r.path}/`));
    const module = attribute(scope, imp.path);
    // Go picks the longest module path that prefixes the import, so a required
    // module nested under the project's path (`gitea.dev/actionslib` beside
    // `module gitea.dev`) supplies the package; a local replace of it is a root
    // of the same length and stays internal.
    if (root && !(module && module.path.length > root.path.length)) {
      const rest = imp.path.slice(root.path.length + 1);
      const dir = root.dir === "" ? rest : rest === "" ? root.dir : `${root.dir}/${rest}`;
      const members = index.packages.get(dir);
      // No inventoried .go file there, so no node to point at: keep the import as an external.
      if (!members) {
        out.externalPackage(imp.path, module);
        continue;
      }
      const symbol = imp.alias ?? "*";
      if (dir !== "") out.file(dir, symbol);
      else for (const member of members) if (!isTestFile(member)) out.file(member, symbol);
    } else if (!module && isGoStdlibPath(imp.path)) {
      out.externalPackage(`stdlib:${imp.path}`, undefined);
    } else {
      out.externalPackage(imp.path, module);
    }
  }
  return out.result();
}

// ── Resolver ────────────────────────────────────────────────────────────────

function createGoResolver(project: GoProject): PackResolver {
  return {
    forProject: async (projectDir) => createGoResolver(await readGoProject(projectDir)),
    prepare(files, unparsed = []): PreparedResolver {
      const index = buildIndex(project, [...files.map((f) => f.path), ...unparsed]);
      const byPath = new Map(files.map((f) => [f.path, f]));
      const cache = new Map<string, FileReferences>();
      return {
        resolve(fromFile) {
          const file = byPath.get(fromFile);
          if (!file) return { files: [], external: [] };
          let refs = cache.get(fromFile);
          if (!refs) cache.set(fromFile, (refs = resolveFile(index, file)));
          return refs;
        },
      };
    },
  };
}

/**
 * The Go resolver. Without {@link PackResolver.forProject} it knows no module,
 * so every import is stdlib or third-party; bind it to a project first.
 */
export const goResolver: PackResolver = createGoResolver(EMPTY_PROJECT);
