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
 * **Resolution order**, every project's `autoload` and `autoload-dev` (the
 * file's own manifest has no priority: Composer merges path repositories'
 * autoload into one loader):
 * 1. PSR-4, longest prefix first: the prefix is cut and the rest, `\` to
 *    `/`, is `<path>/<rest>.php`.
 * 2. PSR-0, longest prefix first: the whole name, namespace `\` to `/` and
 *    the class part's `_` to `/`, is `<path>/<logical>.php`.
 * 3. Classmap: a class declared in a file under a `classmap` path (and not
 *    `exclude-from-classmap`), first file by path.
 * 4. A class declared in exactly one file of the repository (two or more is
 *    `ambiguous`), which also covers repositories without Composer.
 * A file must be one of the pack's files: a vendor directory is not, so its
 * classes are externals.
 *
 * **Unresolved** (decision D5). PHP's own classes and interfaces
 * (`php-builtins.ts`) are no package. A global function or constant is never
 * external: PHP's, the extensions' and the project's own all live there. A
 * name a `composer.lock` package's autoload prefix covers is external with
 * that package as its `module` (version in memory only). Otherwise a name
 * whose first segment is the project's (a declared namespace or class, or a
 * project autoload prefix) is unresolved `internal-not-found`; any other is
 * external, named `php:<first namespace segment>` (`php:Monolog` for
 * `Monolog\Logger`), or for an un-namespaced class its PSR-0 prefix
 * (`php:Zend` for `Zend_Db_Table`). Edge and external symbols are the
 * qualified names.
 *
 * Includes are reported as written (`php-imports.ts`) and not resolved.
 *
 * @module lang-php/php-resolver
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  readComposerProjects,
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

// ── Names and paths ─────────────────────────────────────────────────────────

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

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

/** How a resolved name was found. */
export type PhpResolution = "psr-4" | "psr-0" | "classmap" | "declared";

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

const longestFirst = <T extends { readonly prefix: string }>(items: T[]): T[] =>
  items.sort((a, b) => b.prefix.length - a.prefix.length || compare(a.prefix, b.prefix));

const autoloadsOf = (project: ComposerProject): ComposerAutoload[] => [project.autoload, project.autoloadDev];

/** `exclude-from-classmap` patterns: `**` any path, `*` any name part; matched from the start of a path. */
function excludePattern(pattern: string): RegExp {
  const body = pattern
    .replace(/\/+$/, "")
    .split(/(\*\*|\*)/)
    .map((part) => (part === "**" ? ".*" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}(/|$)`);
}

/** `path` is the file `entry` or lies beneath the directory `entry`. */
const underEntry = (path: string, entry: string): boolean => entry === "" || path === entry || path.startsWith(`${entry}/`);

class Index {
  readonly files: ReadonlySet<string>;
  private readonly psr4: readonly Mapping[];
  private readonly psr0: readonly Mapping[];
  private readonly classmap = new Map<string, string>();
  private readonly classes = new Map<string, string[]>();
  private readonly functions = new Map<string, string[]>();
  private readonly constants = new Map<string, string[]>();
  private readonly lock: readonly LockPrefix[];
  /** First segments, lowercase, that are the project's. */
  private readonly ownHeads = new Set<string>();

  constructor(projects: readonly ComposerProject[], declared: readonly Declared[], paths: readonly string[]) {
    this.files = new Set(paths);
    const autoloads = projects.flatMap(autoloadsOf);
    this.psr4 = longestFirst(autoloads.flatMap((a) => a.psr4.map((m) => ({ prefix: m.prefix, paths: m.paths }))));
    this.psr0 = longestFirst(autoloads.flatMap((a) => a.psr0.map((m) => ({ prefix: m.prefix, paths: m.paths }))));

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
    }
    for (const m of [...this.psr4, ...this.psr0]) {
      const head = headOf(m.prefix.replace(/[\\_]+$/, ""));
      if (head !== "") this.ownHeads.add(head.toLowerCase());
    }
    for (const files of [this.classes, this.functions, this.constants].flatMap((m) => [...m.values()])) files.sort(compare);

    const classmap = autoloads.flatMap((a) => a.classmap);
    const excluded = autoloads.flatMap((a) => a.excludeFromClassmap).map(excludePattern);
    if (classmap.length > 0) {
      const inMap = (file: string): boolean => classmap.some((e) => underEntry(file, e)) && !excluded.some((x) => x.test(file));
      for (const [name, files] of this.classes) {
        const first = files.find(inMap);
        if (first !== undefined) this.classmap.set(name, first);
      }
    }

    this.lock = longestFirst(
      projects.flatMap((p) =>
        (p.lockPackages ?? []).flatMap((pkg) => {
          const module: ExternalModule = { path: pkg.name, ...(pkg.version !== undefined && { version: pkg.version }) };
          return [...pkg.autoload.psr4, ...pkg.autoload.psr0].filter((m) => m.prefix !== "").map((m) => ({ prefix: m.prefix, module }));
        }),
      ),
    );
  }

  /** The file a class is in, or why not; undefined when the project has no trace of it. */
  findClass(qualified: string): PhpOutcome | undefined {
    for (const m of this.psr4) {
      if (!qualified.startsWith(m.prefix)) continue;
      const rest = `${qualified.slice(m.prefix.length).replace(/\\/g, "/")}.php`;
      const target = m.paths.map((p) => joinPath(p, rest)).find((f) => this.files.has(f));
      if (target !== undefined) return { kind: "internal", target, via: "psr-4" };
    }
    const logical = psr0Path(qualified);
    for (const m of this.psr0) {
      if (!qualified.startsWith(m.prefix)) continue;
      const target = m.paths.map((p) => joinPath(p, logical)).find((f) => this.files.has(f));
      if (target !== undefined) return { kind: "internal", target, via: "psr-0" };
    }
    const key = qualified.toLowerCase();
    const mapped = this.classmap.get(key);
    if (mapped !== undefined) return { kind: "internal", target: mapped, via: "classmap" };
    return this.declared(this.classes, key);
  }

  findFunction(qualified: string): PhpOutcome | undefined {
    return this.declared(this.functions, qualified.toLowerCase());
  }

  /** Constant names are case-sensitive, except their namespace; the index is keyed lowercase and a near miss is rare. */
  findConstant(qualified: string): PhpOutcome | undefined {
    return this.declared(this.constants, qualified.toLowerCase());
  }

  private declared(map: ReadonlyMap<string, readonly string[]>, key: string): PhpOutcome | undefined {
    const files = map.get(key);
    if (files === undefined) return undefined;
    return files.length === 1 ? { kind: "internal", target: files[0]!, via: "declared" } : { kind: "unresolved", reason: "ambiguous" };
  }

  lockModule(qualified: string): ExternalModule | undefined {
    return this.lock.find((l) => qualified.startsWith(l.prefix))?.module;
  }

  isOwn(qualified: string): boolean {
    return this.ownHeads.has(headOf(qualified).toLowerCase());
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

/** Record the reference's edge or external in `out`, and say what it resolved to. */
function resolveReference(index: Index, ref: PhpReference, out: Collector): PhpOutcome {
  const { qualified } = ref;
  const found =
    ref.kind === "class" ? index.findClass(qualified) : ref.kind === "function" ? index.findFunction(qualified) : index.findConstant(qualified);
  if (found?.kind === "internal") {
    out.file(found.target, qualified);
    return found;
  }
  if (found !== undefined) return found;
  if (ref.kind === "class" ? isPhpBuiltinClass(qualified) : !qualified.includes("\\")) {
    return ref.kind === "class" ? { kind: "builtin" } : { kind: "global" };
  }
  const module = index.lockModule(qualified);
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
  return readComposerProjects(projectDir, [...listed].sort());
}

// ── Resolver ────────────────────────────────────────────────────────────────

/** A prepared resolver that also keeps what each reference resolved to, for the corpus report. */
export interface PreparedPhpResolver extends PreparedResolver {
  /** Each reference of a prepared file with its outcome, in document order. */
  outcomes(fromFile: string): readonly ResolvedPhpReference[];
}

/** Resolve every file of a project at once. */
export function preparePhpImports(
  projects: readonly ComposerProject[],
  files: readonly PackSourceFile[],
  unparsed: readonly string[] = [],
): PreparedPhpResolver {
  const index = new Index(projects, files.map(declarationsOf), [...files.map((f) => f.path), ...unparsed]);
  const refs = new Map<string, FileReferences>();
  const outcomes = new Map<string, ResolvedPhpReference[]>();
  for (const file of files) {
    const written = readWrittenImports(file);
    const out = new Collector(file.path);
    const resolved = readPhpReferences(file, written).map((reference) => ({ reference, outcome: resolveReference(index, reference, out) }));
    refs.set(file.path, out.result(written));
    outcomes.set(file.path, resolved);
  }
  const notices = projects.flatMap((p) => p.notices.map((n) => `PHP: ${n}`));
  return {
    resolve: (fromFile) => refs.get(fromFile) ?? { files: [], external: [] },
    outcomes: (fromFile) => outcomes.get(fromFile) ?? [],
    notices: () => notices,
  };
}

function createPhpResolver(projects: readonly ComposerProject[]): PackResolver {
  return {
    forProject: async (projectDir, files) => createPhpResolver(await readPhpResolveProjects(projectDir, files)),
    prepare: (files, unparsed) => preparePhpImports(projects, files, unparsed),
  };
}

/**
 * The PHP resolver. Without {@link PackResolver.forProject} it knows no
 * Composer project, so only classes declared in the repository resolve.
 */
export const phpResolver: PackResolver = createPhpResolver([]);
