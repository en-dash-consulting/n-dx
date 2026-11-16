/**
 * PHP namespace resolver: turns each file's `use` imports and class
 * references into edges to project files and into external packages, the
 * way Composer's autoloader finds classes. Composer is never run:
 * {@link phpResolver.forProject} reads lang-kit's Composer projects
 * (`composer.json`, `composer.lock`) from the directories holding the pack's
 * files, as text.
 *
 * **Names.** A class name is qualified as PHP does: a leading `\` is fully
 * qualified; `namespace\X` is the current namespace's; otherwise the first
 * segment is replaced by the `use` import it names (case-insensitively), or
 * the current namespace is prefixed. Class names never fall back to the
 * global namespace. `use function` and `use const` are kept apart from class
 * imports and only name functions and constants. `self`, `static` and
 * `parent` are the enclosing class, not references.
 *
 * **References** (`queries/php/references.scm`): `use` imports, `extends`,
 * `implements`, trait `use`, `new`, `X::` (calls, constants, `::class`,
 * properties), parameter, return, property and `catch` types, `instanceof`.
 *
 * **Scope.** A file resolves through the `autoload` and `autoload-dev` of
 * the project owning it (the nearest enclosing `composer.json`) and of each
 * project a `path` repository of that project points at and it requires,
 * merged as Composer's one loader merges them; the same scope holds for the
 * classmap, `composer.lock` prefixes and the declared-class fallback, so two
 * apps mapping one namespace never link to each other. A file outside every
 * project resolves through every project's.
 *
 * **Resolution order**:
 * 1. PSR-4, longest prefix first: the prefix is cut and the rest, `\` to
 *    `/`, is `<path>/<rest>.php`.
 * 2. PSR-0, longest prefix first: the whole name, namespace `\` to `/` and
 *    the class part's `_` to `/`, is `<path>/<logical>.php`.
 * 3. Classmap: a class declared in a file under a `classmap` path (and not
 *    `exclude-from-classmap`), first file by path.
 * 4. Legacy loading, for code without Composer: a file a legacy autoloader
 *    would include (`php-autoloaders.ts`), then the PSR-0 path
 *    (`Vendor_Pkg_Class` is `Vendor/Pkg/Class.php`) under the referring
 *    file's include-path roots (`php-includes.ts`) or the repository root.
 *    The file must declare the class, or have failed to parse while no file
 *    declares it, so a pattern picks one of several declarations.
 * 5. A class declared in exactly one file of the repository (two or more is
 *    `ambiguous`).
 * A file must be one of the pack's files: a vendor directory is not, so its
 * classes are externals.
 *
 * **Unresolved** (decision D5). PHP's own classes and interfaces
 * (`php-builtins.ts`) are no package. A global function or constant is never
 * external: PHP's, the extensions' and the project's own all live there. A
 * name a `composer.lock` package's autoload prefix covers is external with
 * that package as its `module` (version in memory only). Otherwise a name
 * that is the project's is unresolved `internal-not-found`: a namespaced
 * name whose namespace (all but its last segment) the project declares, that
 * a project PSR-4 or PSR-0 prefix covers, or that is itself a declared
 * namespace or a leading part of one; an un-namespaced class whose PSR-0
 * prefix (`Zend` of `Zend_Gdata_YouTube`) is the first segment of a declared
 * namespace or class or of a project autoload prefix. Sharing only the root
 * namespace is not enough: `Acme\Shared\Money` beside the project's
 * `Acme\Billing` is a library's. Any other name is external, named `php:<first namespace segment>` (`php:Monolog` for
 * `Monolog\Logger`), or for an un-namespaced class its PSR-0 prefix
 * (`php:Zend` for `Zend_Db_Table`). Edge and external symbols are the
 * qualified names.
 *
 * Includes (`include`, `require` and their `_once` forms) whose path is
 * computable resolve to files through `php-includes.ts`, with symbol `*`;
 * the written include keeps its guard. A dynamic include gives no edge: its
 * written import carries its candidate files, and a notice counts it
 * (`php-include-notices.ts`).
 *
 * @module lang-php/php-resolver
 */

import { readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  readComposerProjects,
  trimTrailing,
  type ComposerAutoload,
  type ComposerProject,
  type ExternalModule,
  type FileReferences,
  type SourcePosition,
  type WrittenImport,
} from "@n-dx/lang-kit";
import { contains, type Capture, type PackResolver, type PackSourceFile, type PreparedResolver } from "@n-dx/lang-runtime";
import { isPhpBuiltinClass } from "./php-builtins.js";
import { readWrittenImports } from "./php-imports.js";
import { PhpAutoloaders } from "./php-autoloaders.js";
import { findCrontabFiles, readCrontabFiles } from "./php-cron.js";
import { dirOf } from "./php-docroots.js";
import { dynamicIncludeNotices, hostReader, type DynamicInclude } from "./php-include-notices.js";
import { isInclude, PhpIncludes, readPhpIncludeConfigs, type PhpIncludeConfig, type PhpIncludeOutcome } from "./php-includes.js";

// ── Names and paths ─────────────────────────────────────────────────────────

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const joinPath = (...parts: string[]): string => parts.filter((p) => p !== "").join("/");

/** A name as written, without the whitespace PHP 7 allowed around `\`. */
const tidy = (text: string): string => text.replace(/\s+/g, "");

/** First namespace segment; for an un-namespaced class, its PSR-0 prefix (`Zend` of `Zend_Db_Table`). */
function headOf(qualified: string): string {
  const sep = qualified.indexOf("\\");
  if (sep >= 0) return qualified.slice(0, sep);
  const underscore = qualified.indexOf("_");
  return underscore > 0 ? qualified.slice(0, underscore) : qualified;
}

/** The namespace of a qualified name: all but its last segment; "" for an un-namespaced name. */
function namespaceOf(qualified: string): string {
  const sep = qualified.lastIndexOf("\\");
  return sep < 0 ? "" : qualified.slice(0, sep);
}

/** PSR-0's logical path: the namespace's `\` and the class name's `_` become `/`. */
function psr0Path(qualified: string): string {
  const sep = qualified.lastIndexOf("\\");
  const namespace = sep < 0 ? "" : qualified.slice(0, sep + 1).replace(/\\/g, "/");
  return `${namespace}${qualified.slice(sep + 1).replace(/_/g, "/")}.php`;
}

const before = (a: SourcePosition, b: SourcePosition): boolean => a.line < b.line || (a.line === b.line && a.column <= b.column);

// ── References ──────────────────────────────────────────────────────────────

/** Where a reference stands: a `use` import's form, or the place of a class name in code. */
export type PhpReferenceForm =
  | "use"
  | "use function"
  | "use const"
  | "extends"
  | "implements"
  | "trait"
  | "new"
  | "static"
  | "type"
  | "instanceof";

/** One name a file refers to. */
export interface PhpReference {
  readonly form: PhpReferenceForm;
  /** What the name names. */
  readonly kind: "class" | "function" | "const";
  /** As written. */
  readonly written: string;
  /** Fully qualified, without the leading `\`. */
  readonly qualified: string;
  readonly position: SourcePosition;
}

/**
 * How a resolved name was found: Composer's `psr-4`, `psr-0` and
 * `classmap`; an `autoloader` pattern; the PSR-0 directory convention under
 * the include path or the repository root (`psr-0-path`); or the one file
 * declaring it (`declared`).
 */
export type PhpResolution = "psr-4" | "psr-0" | "classmap" | "autoloader" | "psr-0-path" | "declared";

/** What one reference resolved to. */
export type PhpOutcome =
  | { readonly kind: "internal"; readonly target: string; readonly via: PhpResolution }
  /** One of PHP's own classes or interfaces. */
  | { readonly kind: "builtin" }
  /** A global function or constant no project file declares: PHP's, an extension's or the project's own. */
  | { readonly kind: "global" }
  /** `dependency` is the composer.lock package whose autoload prefix covers the name. */
  | { readonly kind: "external"; readonly package: string; readonly dependency?: string }
  | { readonly kind: "unresolved"; readonly reason: "internal-not-found" | "ambiguous" };

export interface ResolvedPhpReference {
  readonly reference: PhpReference;
  readonly outcome: PhpOutcome;
}

const REFERENCE_FORMS: Readonly<Record<string, PhpReferenceForm>> = {
  "reference.extends": "extends",
  "reference.implements": "implements",
  "reference.trait": "trait",
  "reference.new": "new",
  "reference.static": "static",
  "reference.type": "type",
  "reference.instanceof": "instanceof",
};

/** The enclosing class, not a reference. */
const RELATIVE_CLASSES = new Set(["self", "static", "parent"]);

/**
 * Type keywords. The grammar matches some only in lower case (`array`,
 * `bool`, `float`, `int`, `null`, `object`, `string`), but PHP reads them in
 * any case, so `String $s` reaches the resolver as a class name.
 */
const SCALAR_TYPES = new Set(["array", "bool", "callable", "false", "float", "int", "iterable", "mixed", "never", "null", "object", "string", "true", "void"]);

/** A namespace region: a braced block, or an unbraced statement up to the next. */
interface Region {
  readonly name: string;
  readonly start: SourcePosition;
  /** Set for a braced namespace. */
  readonly end?: SourcePosition;
}

/** The file's namespace regions, in document order. */
function regionsOf(file: PackSourceFile): Region[] {
  const defs = file.captures.definitions ?? [];
  const names = defs.filter((c) => c.name === "namespace.name");
  const bodies = defs.filter((c) => c.name === "namespace.body");
  return defs
    .filter((c) => c.name === "namespace.declaration")
    .map((declaration): Region | undefined => {
      const name = names.find((n) => contains(declaration, n));
      if (name === undefined) return undefined;
      const braced = bodies.some((b) => contains(declaration, b));
      return { name: tidy(name.text).replace(/^\\/, ""), start: declaration.start, ...(braced ? { end: declaration.end } : {}) };
    })
    .filter((r): r is Region => r !== undefined)
    .sort((a, b) => (before(a.start, b.start) ? -1 : 1));
}

/** The region holding `at`; undefined in the global namespace. */
function regionAt(regions: readonly Region[], at: SourcePosition): Region | undefined {
  let found: Region | undefined;
  for (const region of regions) {
    if (!before(region.start, at)) break;
    found = region;
  }
  if (found?.end !== undefined && !before(at, found.end)) return undefined;
  return found;
}

const inNamespace = (region: Region | undefined, name: string): string => (region === undefined ? name : `${region.name}\\${name}`);

/** A file's class imports per region (undefined is global): local name, lowercase, to the qualified name. */
function classAliases(regions: readonly Region[], written: readonly WrittenImport[]): Map<Region | undefined, Map<string, string>> {
  const byRegion = new Map<Region | undefined, Map<string, string>>();
  for (const w of written) {
    if (w.form !== "use") continue;
    const region = regionAt(regions, w.position);
    let aliases = byRegion.get(region);
    if (!aliases) byRegion.set(region, (aliases = new Map()));
    const qualified = w.specifier.replace(/^\\/, "");
    const local = w.alias ?? qualified.slice(qualified.lastIndexOf("\\") + 1);
    aliases.set(local.toLowerCase(), qualified);
  }
  return byRegion;
}

/** Every name the file refers to, in document order. */
export function readPhpReferences(file: PackSourceFile, written: readonly WrittenImport[] = readWrittenImports(file)): PhpReference[] {
  const regions = regionsOf(file);
  const aliases = classAliases(regions, written);
  const refs: PhpReference[] = [];

  for (const w of written) {
    const kind = w.form === "use" ? "class" : w.form === "use function" ? "function" : w.form === "use const" ? "const" : undefined;
    if (kind === undefined) continue; // includes are not namespace references
    refs.push({ form: w.form as PhpReferenceForm, kind, written: w.specifier, qualified: w.specifier.replace(/^\\/, ""), position: w.position });
  }

  for (const capture of file.captures.references ?? []) {
    const form = REFERENCE_FORMS[capture.name];
    if (form === undefined) continue;
    const qualified = qualifyClass(capture, regionAt(regions, capture.start), aliases);
    if (qualified !== undefined) refs.push({ form, kind: "class", written: tidy(capture.text), qualified, position: capture.start });
  }

  return refs.sort((a, b) => a.position.line - b.position.line || a.position.column - b.position.column);
}

/** A class name qualified as PHP does; undefined for `self`, `static`, `parent` and a type keyword in any case. */
function qualifyClass(capture: Capture, region: Region | undefined, aliases: ReadonlyMap<Region | undefined, ReadonlyMap<string, string>>): string | undefined {
  const name = tidy(capture.text);
  if (name.startsWith("\\")) return name.slice(1);
  if (/^namespace\\/i.test(name)) return inNamespace(region, name.slice("namespace\\".length));
  const lower = name.toLowerCase();
  if (RELATIVE_CLASSES.has(lower) || (capture.name === "reference.type" && SCALAR_TYPES.has(lower))) return undefined;
  const sep = name.indexOf("\\");
  const head = sep < 0 ? name : name.slice(0, sep);
  const imported = aliases.get(region)?.get(head.toLowerCase());
  if (imported !== undefined) return sep < 0 ? imported : `${imported}${name.slice(sep)}`;
  return inNamespace(region, name);
}

// ── Declarations ────────────────────────────────────────────────────────────

const TYPE_NAMES = ["class.name", "interface.name", "trait.name", "enum.name"];
const TYPE_DECLARATIONS = ["class.declaration", "interface.declaration", "trait.declaration", "enum.declaration"];

interface Declared {
  readonly classes: ReadonlyArray<{ readonly name: string; readonly file: string }>;
  readonly functions: ReadonlyArray<{ readonly name: string; readonly file: string }>;
  readonly constants: ReadonlyArray<{ readonly name: string; readonly file: string }>;
  readonly namespaces: readonly string[];
}

/** What a file declares, each name fully qualified. */
function declarationsOf(file: PackSourceFile): Declared {
  const defs = file.captures.definitions ?? [];
  const regions = regionsOf(file);
  const qualify = (c: Capture): string => inNamespace(regionAt(regions, c.start), tidy(c.text));
  const at = (name: string) => ({ name, file: file.path });
  const types = defs.filter((c) => TYPE_DECLARATIONS.includes(c.name));
  const constants = defs
    .filter((c) => c.name === "constant.name" && !types.some((t) => contains(t, c)))
    .map((c) => at(qualify(c)));
  for (const c of defs) {
    if (c.name !== "define.name") continue;
    const literal = c.text.slice(1, -1);
    if (/^\\?[A-Za-z_\x80-￿][\w\x80-￿]*(\\[A-Za-z_\x80-￿][\w\x80-￿]*)*$/.test(literal)) constants.push(at(literal.replace(/^\\/, "")));
  }
  return {
    classes: defs.filter((c) => TYPE_NAMES.includes(c.name)).map((c) => at(qualify(c))),
    functions: defs.filter((c) => c.name === "function.name").map((c) => at(qualify(c))),
    constants,
    namespaces: regions.map((r) => r.name),
  };
}

// ── Index ───────────────────────────────────────────────────────────────────

interface Mapping {
  readonly prefix: string;
  readonly paths: readonly string[];
}

interface LockPrefix {
  readonly prefix: string;
  readonly module: ExternalModule;
}

/** The autoload a referring file sees: one project's and its required path repositories', or every project's. */
interface Scope {
  readonly psr4: readonly Mapping[];
  readonly psr0: readonly Mapping[];
  /** Class name, lowercase, to the first file by path declaring it under a `classmap` entry. */
  readonly classmap: ReadonlyMap<string, string>;
  readonly lock: readonly LockPrefix[];
  /** Directories of the projects in scope; undefined when every project is. */
  readonly projects?: ReadonlySet<string>;
}

const longestFirst = <T extends { readonly prefix: string }>(items: T[]): T[] =>
  items.sort((a, b) => b.prefix.length - a.prefix.length || compare(a.prefix, b.prefix));

const autoloadsOf = (project: ComposerProject): ComposerAutoload[] => [project.autoload, project.autoloadDev];

/** `text` matches `pattern`, where `*` is any run of characters; linear backtracking on the last `*`. */
function globMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      resume = t;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (star >= 0) {
      p = star + 1;
      t = ++resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

/** A path repository's `url`, resolved against its project's directory, matches the project directory `dir` (`*` within a segment). */
function pathRepositoryMatches(base: string, url: string, dir: string): boolean {
  const resolved = posix.normalize(posix.join(base, url.replace(/\\/g, "/")));
  const segments = resolved.split("/").filter((s) => s !== "" && s !== ".");
  const dirSegments = dir === "" ? [] : dir.split("/");
  return segments.length === dirSegments.length && segments.every((s, i) => globMatch(s, dirSegments[i]!));
}

/**
 * The projects whose autoload `owner` loads: itself, and each project a
 * `path` repository of `owner` points at that `owner` requires, directly or
 * through another such project (Composer reads repositories from the root
 * manifest only).
 */
function projectsInScope(owner: ComposerProject, projects: readonly ComposerProject[]): ComposerProject[] {
  const paths = owner.repositories.filter((r) => r.type === "path");
  const available = projects.filter((p) => p !== owner && p.name !== undefined && paths.some((r) => pathRepositoryMatches(owner.dir, r.url, p.dir)));
  const inScope = [owner];
  for (let i = 0; i < inScope.length; i++) {
    for (const req of inScope[i]!.requirements) {
      const required = available.find((p) => p.name === req.name && !inScope.includes(p));
      if (required !== undefined) inScope.push(required);
    }
  }
  return inScope;
}

/** `exclude-from-classmap` patterns: `**` any path, `*` any name part; matched from the start of a path. */
function excludePattern(pattern: string): RegExp {
  const body = trimTrailing(pattern, "/")
    .split(/(\*\*|\*)/)
    .map((part) => (part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}(/|$)`);
}

/** `path` is the file `entry` or lies beneath the directory `entry`. */
const underEntry = (path: string, entry: string): boolean => entry === "" || path === entry || path.startsWith(`${entry}/`);

/** Where a legacy lookup would load a class from, in the order it tries them. */
type LegacyCandidates = (qualified: string, fromFile: string) => Iterable<{ readonly target: string; readonly via: PhpResolution }>;

class Index {
  readonly files: ReadonlySet<string>;
  /** Files with captures; a file outside it failed to parse, so what it declares is unknown. */
  private readonly parsed: ReadonlySet<string>;
  private readonly projects: readonly ComposerProject[];
  /** Every project's autoload: for a file outside every project. */
  private readonly everyProject: Scope;
  /** Each project's scope by its directory, built on first use. */
  private readonly scopes = new Map<string, Scope>();
  /** Each file's owning project directory (undefined: none), by path. */
  private readonly owners = new Map<string, string | undefined>();
  private readonly classes = new Map<string, string[]>();
  private readonly functions = new Map<string, string[]>();
  private readonly constants = new Map<string, string[]>();
  /** Namespaces, lowercase, that the project declares (a `namespace` statement or a declared class's). */
  private readonly ownNamespaces = new Set<string>();
  /** Every leading run of segments of {@link ownNamespaces}: a `use` of one names a namespace, not a missing class. */
  private readonly ownNamespacePrefixes = new Set<string>();
  /** PSR-4 and PSR-0 prefixes of the project's autoload, lowercase. */
  private readonly ownPrefixes: readonly string[];
  /** First segments or PSR-0 prefixes, lowercase, that are the project's; for un-namespaced names only. */
  private readonly ownHeads = new Set<string>();

  constructor(projects: readonly ComposerProject[], declared: readonly Declared[], parsed: readonly string[], unparsed: readonly string[]) {
    this.parsed = new Set(parsed);
    this.files = new Set([...parsed, ...unparsed]);
    this.projects = projects;

    const add = (map: Map<string, string[]>, name: string, file: string): void => {
      const key = name.toLowerCase();
      const files = map.get(key);
      if (!files) map.set(key, [file]);
      else if (!files.includes(file)) files.push(file);
    };
    for (const d of declared) {
      for (const c of d.classes) add(this.classes, c.name, c.file);
      for (const f of d.functions) add(this.functions, f.name, f.file);
      for (const c of d.constants) add(this.constants, c.name, c.file);
      for (const n of d.namespaces) this.ownHeads.add(headOf(n).toLowerCase());
      for (const c of d.classes) this.ownHeads.add(headOf(c.name).toLowerCase());
      for (const n of [...d.namespaces, ...d.classes.map((c) => namespaceOf(c.name))]) {
        if (n === "") continue;
        const lower = n.toLowerCase();
        this.ownNamespaces.add(lower);
        for (let sep = lower.indexOf("\\"); sep >= 0; sep = lower.indexOf("\\", sep + 1)) this.ownNamespacePrefixes.add(lower.slice(0, sep));
        this.ownNamespacePrefixes.add(lower);
      }
    }
    for (const files of [this.classes, this.functions, this.constants].flatMap((m) => [...m.values()])) files.sort(compare);

    this.everyProject = this.scopeOver(projects);
    this.ownPrefixes = [...this.everyProject.psr4, ...this.everyProject.psr0].map((m) => m.prefix.toLowerCase()).filter((p) => p !== "");
    for (const m of [...this.everyProject.psr4, ...this.everyProject.psr0]) {
      const head = headOf(m.prefix.replace(/[\\_]+$/, ""));
      if (head !== "") this.ownHeads.add(head.toLowerCase());
    }
  }

  /** The autoload of `projects` merged: PSR-4 and PSR-0 longest prefix first, the classmap, lock prefixes. */
  private scopeOver(projects: readonly ComposerProject[], dirs?: ReadonlySet<string>): Scope {
    const autoloads = projects.flatMap(autoloadsOf);
    const classmap = new Map<string, string>();
    const entries = autoloads.flatMap((a) => a.classmap);
    const excluded = autoloads.flatMap((a) => a.excludeFromClassmap).map(excludePattern);
    if (entries.length > 0) {
      const inMap = (file: string): boolean => entries.some((e) => underEntry(file, e)) && !excluded.some((x) => x.test(file));
      for (const [name, files] of this.classes) {
        const first = files.find(inMap);
        if (first !== undefined) classmap.set(name, first);
      }
    }
    return {
      psr4: longestFirst(autoloads.flatMap((a) => a.psr4.map((m) => ({ prefix: m.prefix, paths: m.paths })))),
      psr0: longestFirst(autoloads.flatMap((a) => a.psr0.map((m) => ({ prefix: m.prefix, paths: m.paths })))),
      classmap,
      lock: longestFirst(
        projects.flatMap((p) =>
          (p.lockPackages ?? []).flatMap((pkg) => {
            const module: ExternalModule = { path: pkg.name, ...(pkg.version !== undefined && { version: pkg.version }) };
            return [...pkg.autoload.psr4, ...pkg.autoload.psr0].filter((m) => m.prefix !== "").map((m) => ({ prefix: m.prefix, module }));
          }),
        ),
      ),
      ...(dirs && { projects: dirs }),
    };
  }

  /** The directory of the project owning `file`: the nearest enclosing `composer.json`; undefined outside every project. */
  private ownerOf(file: string): string | undefined {
    if (this.owners.has(file)) return this.owners.get(file);
    let owner: string | undefined;
    for (const p of this.projects) {
      if (underEntry(file, p.dir) && (owner === undefined || p.dir.length > owner.length)) owner = p.dir;
    }
    this.owners.set(file, owner);
    return owner;
  }

  /** What `fromFile` autoloads: its project's and that project's required path repositories', or every project's outside them all. */
  private scopeOf(fromFile: string): Scope {
    const owner = this.ownerOf(fromFile);
    if (owner === undefined) return this.everyProject;
    let scope = this.scopes.get(owner);
    if (scope === undefined) {
      const inScope = projectsInScope(this.projects.find((p) => p.dir === owner)!, this.projects);
      scope = this.scopeOver(inScope, new Set(inScope.map((p) => p.dir)));
      this.scopes.set(owner, scope);
    }
    return scope;
  }

  /**
   * The file a class is in, or why not; undefined when the project has no
   * trace of it. After Composer's rules, a `legacy` candidate is taken when
   * it declares the class (or failed to parse and no file declares it), so a
   * pattern can pick one of several declarations. A declaration in another
   * project than those `fromFile`'s scope holds does not count.
   */
  findClass(qualified: string, fromFile: string, legacy?: LegacyCandidates): PhpOutcome | undefined {
    const scope = this.scopeOf(fromFile);
    for (const m of scope.psr4) {
      if (!qualified.startsWith(m.prefix)) continue;
      const rest = `${qualified.slice(m.prefix.length).replace(/\\/g, "/")}.php`;
      const target = m.paths.map((p) => joinPath(p, rest)).find((f) => this.files.has(f));
      if (target !== undefined) return { kind: "internal", target, via: "psr-4" };
    }
    const logical = psr0Path(qualified);
    for (const m of scope.psr0) {
      if (!qualified.startsWith(m.prefix)) continue;
      const target = m.paths.map((p) => joinPath(p, logical)).find((f) => this.files.has(f));
      if (target !== undefined) return { kind: "internal", target, via: "psr-0" };
    }
    const key = qualified.toLowerCase();
    const mapped = scope.classmap.get(key);
    if (mapped !== undefined) return { kind: "internal", target: mapped, via: "classmap" };
    const declaring = this.classes.get(key);
    for (const { target, via } of legacy?.(qualified, fromFile) ?? []) {
      if (declaring === undefined ? !this.parsed.has(target) : declaring.includes(target)) return { kind: "internal", target, via };
    }
    const { projects } = scope;
    if (projects === undefined || declaring === undefined) return this.declared(this.classes, key);
    const visible = declaring.filter((file) => {
      const owner = this.ownerOf(file);
      return owner === undefined || projects.has(owner);
    });
    return this.oneOf(visible);
  }

  findFunction(qualified: string): PhpOutcome | undefined {
    return this.declared(this.functions, qualified.toLowerCase());
  }

  /** Constant names are case-sensitive, except their namespace; the index is keyed lowercase and a near miss is rare. */
  findConstant(qualified: string): PhpOutcome | undefined {
    return this.declared(this.constants, qualified.toLowerCase());
  }

  private declared(map: ReadonlyMap<string, readonly string[]>, key: string): PhpOutcome | undefined {
    return this.oneOf(map.get(key));
  }

  /** The one declaring file; ambiguous for two or more; undefined for none. */
  private oneOf(files: readonly string[] | undefined): PhpOutcome | undefined {
    if (files === undefined || files.length === 0) return undefined;
    return files.length === 1 ? { kind: "internal", target: files[0]!, via: "declared" } : { kind: "unresolved", reason: "ambiguous" };
  }

  /** The composer.lock package, of a project in `fromFile`'s scope, whose autoload prefix covers the name. */
  lockModule(qualified: string, fromFile: string): ExternalModule | undefined {
    return this.scopeOf(fromFile).lock.find((l) => qualified.startsWith(l.prefix))?.module;
  }

  /**
   * Whether a name no file holds is the project's: a namespaced name when the
   * project declares its namespace, a project autoload prefix covers it, or
   * it is itself a declared namespace or a leading part of one; an
   * un-namespaced name when its PSR-0 prefix is a project head. A library
   * sharing the project's root namespace (`Acme\Shared` beside `Acme\Billing`)
   * is not the project's.
   */
  isOwn(qualified: string): boolean {
    const lower = qualified.toLowerCase();
    if (!lower.includes("\\")) return this.ownHeads.has(headOf(lower));
    return (
      this.ownNamespaces.has(namespaceOf(lower)) ||
      this.ownNamespacePrefixes.has(lower) ||
      this.ownPrefixes.some((p) => lower.startsWith(p))
    );
  }
}

// ── Per-file resolution ─────────────────────────────────────────────────────

/** Starts every external the pack emits, so Composer names never merge with another pack's. */
export const PHP_EXTERNAL_PREFIX = "php:";

class Collector {
  private readonly files = new Map<string, Set<string>>();
  private readonly external = new Map<string, { symbols: Set<string>; module?: ExternalModule }>();

  constructor(private readonly self: string) {}

  file(to: string, symbol: string): void {
    if (to === this.self) return;
    let symbols = this.files.get(to);
    if (!symbols) this.files.set(to, (symbols = new Set()));
    symbols.add(symbol);
  }

  externalPackage(pkg: string, symbol: string, module: ExternalModule | undefined): void {
    let entry = this.external.get(pkg);
    if (!entry) this.external.set(pkg, (entry = { symbols: new Set(), ...(module && { module }) }));
    entry.symbols.add(symbol);
  }

  result(written: readonly WrittenImport[]): FileReferences {
    return {
      files: [...this.files.entries()].sort(([a], [b]) => compare(a, b)).map(([to, symbols]) => ({ to, symbols: [...symbols].sort(compare) })),
      external: [...this.external.entries()]
        .sort(([a], [b]) => compare(a, b))
        .map(([pkg, { symbols, module }]) => ({ package: pkg, symbols: [...symbols].sort(compare), ...(module && { module }) })),
      written,
    };
  }
}

/**
 * A class's legacy candidates, all of them project files: each file its
 * autoloaders would include, then its PSR-0 path (`Vendor_Pkg_Class` is
 * `Vendor/Pkg/Class.php`) searched as an include written in `fromFile` (the
 * include-path roots, then its directory), then at the repository root.
 */
function legacyCandidates(autoloaders: PhpAutoloaders, includes: PhpIncludes, files: ReadonlySet<string>): LegacyCandidates {
  return function* (qualified, fromFile) {
    for (const target of autoloaders.candidates(qualified)) yield { target, via: "autoloader" };
    const path = psr0Path(qualified);
    const found = includes.resolveValue(fromFile, path);
    if (found.kind === "internal") yield { target: found.target, via: "psr-0-path" };
    if (files.has(path)) yield { target: path, via: "psr-0-path" };
  };
}

/** Record the reference's edge or external in `out`, and say what it resolved to. */
function resolveReference(index: Index, ref: PhpReference, fromFile: string, legacy: LegacyCandidates, out: Collector): PhpOutcome {
  const { qualified } = ref;
  const found =
    ref.kind === "class"
      ? index.findClass(qualified, fromFile, legacy)
      : ref.kind === "function"
        ? index.findFunction(qualified)
        : index.findConstant(qualified);
  if (found?.kind === "internal") {
    out.file(found.target, qualified);
    return found;
  }
  if (found !== undefined) return found;
  if (ref.kind === "class" ? isPhpBuiltinClass(qualified) : !qualified.includes("\\")) {
    return ref.kind === "class" ? { kind: "builtin" } : { kind: "global" };
  }
  const module = index.lockModule(qualified, fromFile);
  if (module === undefined && index.isOwn(qualified)) return { kind: "unresolved", reason: "internal-not-found" };
  const pkg = `${PHP_EXTERNAL_PREFIX}${headOf(qualified)}`;
  out.externalPackage(pkg, qualified, module);
  return module === undefined ? { kind: "external", package: pkg } : { kind: "external", package: pkg, dependency: module.path };
}

// ── Project facts ───────────────────────────────────────────────────────────

/**
 * The Composer projects around `files`: every file in each directory that
 * holds one of them or lies above one is offered to lang-kit's reader, which
 * finds the manifests in that list. Nothing else of the project is walked.
 */
export async function readPhpResolveProjects(projectDir: string, files: readonly string[]): Promise<ComposerProject[]> {
  return readComposerProjects(projectDir, await listBeside(projectDir, files));
}

/** Composer projects and include-path settings around `files`; see {@link readPhpResolveProjects} and `php-includes.ts`. */
export interface PhpProjectFacts {
  readonly projects: readonly ComposerProject[];
  readonly includeConfigs: readonly PhpIncludeConfig[];
  /** Each `.htaccess`'s text by path: part of the resolver's `configFiles`, for the docroot routes. */
  readonly htaccess: ReadonlyMap<string, string>;
  /** Each crontab-like file's text by path (`php-cron.ts`): part of the resolver's `configFiles`, for the entry points. */
  readonly crontabs: ReadonlyMap<string, string>;
  /** Configuration files that could not be read. */
  readonly notices: readonly string[];
}

/** What resolution and the frameworks read from outside the PHP files: Composer manifests, php.ini, `.user.ini`, `.htaccess` and crontabs. */
export async function readPhpProjectFacts(projectDir: string, files: readonly string[]): Promise<PhpProjectFacts> {
  const listed = await listBeside(projectDir, files);
  const { configs, htaccess, notices } = await readPhpIncludeConfigs(projectDir, listed);
  const cron = await readCrontabFiles(projectDir, await findCrontabFiles(projectDir, listed));
  return {
    projects: await readComposerProjects(projectDir, listed),
    includeConfigs: configs,
    htaccess,
    crontabs: cron.crontabs,
    notices: [...notices, ...cron.notices],
  };
}

/** `files` and every file in a directory holding one of them or above one, sorted. */
async function listBeside(projectDir: string, files: readonly string[]): Promise<string[]> {
  const dirs = new Set<string>([""]);
  for (const file of files) {
    for (let dir = dirOf(file); dir !== "" && !dirs.has(dir); dir = dirOf(dir)) dirs.add(dir);
  }
  const listed = new Set(files);
  for (const dir of [...dirs].sort()) {
    let entries;
    try {
      entries = await readdir(join(projectDir, dir), { withFileTypes: true });
    } catch {
      continue; // an unreadable directory holds no manifest the reader could read
    }
    for (const entry of entries) if (entry.isFile()) listed.add(joinPath(dir, entry.name));
  }
  return [...listed].sort();
}

// ── Resolver ────────────────────────────────────────────────────────────────

/** A prepared resolver that also keeps what each reference resolved to, for the corpus report. */
export interface PreparedPhpResolver extends PreparedResolver {
  /** Each reference of a prepared file with its outcome, in document order. */
  outcomes(fromFile: string): readonly ResolvedPhpReference[];
  /** Each include of a prepared file with its outcome, in document order. */
  includes(fromFile: string): readonly ResolvedPhpInclude[];
}

/** One include and what it resolved to. */
export interface ResolvedPhpInclude {
  readonly include: WrittenImport;
  readonly outcome: PhpIncludeOutcome;
  /** A dynamic include whose path reads the request's host name, in the path or through a variable (`hostReader`). */
  readonly host?: true;
}

/** Include-path settings read from configuration files, and the files that could not be read. */
export type PhpIncludeSettings = Pick<PhpProjectFacts, "includeConfigs" | "notices">;

const NO_INCLUDE_SETTINGS: PhpIncludeSettings = { includeConfigs: [], notices: [] };

/** Resolve every file of a project at once. */
export function preparePhpImports(
  projects: readonly ComposerProject[],
  files: readonly PackSourceFile[],
  unparsed: readonly string[] = [],
  includeSettings: PhpIncludeSettings = NO_INCLUDE_SETTINGS,
): PreparedPhpResolver {
  const index = new Index(projects, files.map(declarationsOf), files.map((f) => f.path), unparsed);
  const includes = new PhpIncludes(files, index.files, includeSettings.includeConfigs);
  const autoloaders = new PhpAutoloaders(files, includes);
  const legacy = legacyCandidates(autoloaders, includes, index.files);
  const refs = new Map<string, FileReferences>();
  const outcomes = new Map<string, ResolvedPhpReference[]>();
  const includeOutcomes = new Map<string, ResolvedPhpInclude[]>();
  const dynamic: DynamicInclude[] = [];
  for (const file of files) {
    const out = new Collector(file.path);
    const resolvedIncludes: ResolvedPhpInclude[] = [];
    let readsHost: ReturnType<typeof hostReader> | undefined;
    // A dynamic include's candidates go on its written import only: they are never edges.
    const written = readWrittenImports(file).map((w) => {
      if (!isInclude(w)) return w;
      const outcome = includes.resolve(file.path, w);
      if (outcome.kind === "internal") out.file(outcome.target, "*");
      if (outcome.kind !== "unresolved" || outcome.reason !== "dynamic") {
        resolvedIncludes.push({ include: w, outcome });
        return w;
      }
      const candidates = outcome.candidates;
      const include = candidates === undefined ? w : { ...w, candidates: candidates.files };
      readsHost ??= hostReader(file);
      const host = readsHost(w.specifier, w.position);
      dynamic.push({ path: file.path, position: w.position, specifier: w.specifier, host, ...(candidates && { candidates }) });
      resolvedIncludes.push({ include, outcome, ...(host && { host }) });
      return include;
    });
    const resolved = readPhpReferences(file, written).map((reference) => ({ reference, outcome: resolveReference(index, reference, file.path, legacy, out) }));
    refs.set(file.path, out.result(written));
    outcomes.set(file.path, resolved);
    includeOutcomes.set(file.path, resolvedIncludes);
  }
  const notices = [
    ...projects.flatMap((p) => p.notices),
    ...includeSettings.notices,
    ...includes.notices(),
    ...autoloaders.notices(),
    ...dynamicIncludeNotices(dynamic),
  ].map((n) => `PHP: ${n}`);
  return {
    resolve: (fromFile) => refs.get(fromFile) ?? { files: [], external: [] },
    outcomes: (fromFile) => outcomes.get(fromFile) ?? [],
    includes: (fromFile) => includeOutcomes.get(fromFile) ?? [],
    notices: () => notices,
  };
}

function createPhpResolver(facts: PhpProjectFacts): PackResolver {
  return {
    forProject: async (projectDir, files) => createPhpResolver(await readPhpProjectFacts(projectDir, files)),
    configFiles: () => new Map([...facts.htaccess, ...facts.crontabs]),
    prepare: (files, unparsed) => preparePhpImports(facts.projects, files, unparsed, facts),
  };
}

/**
 * The PHP resolver. Without {@link PackResolver.forProject} it knows no
 * Composer project and no configuration file, so only classes declared in
 * the repository and includes set up in PHP code resolve.
 */
export const phpResolver: PackResolver = createPhpResolver({ projects: [], htaccess: new Map(), crontabs: new Map(), ...NO_INCLUDE_SETTINGS });
