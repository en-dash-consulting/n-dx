/**
 * Java reference resolver: turns the Java pack's captures into file-to-file
 * references and external packages.
 *
 * `prepare` indexes every declared type by qualified name (nested types
 * included, each mapped to the file of its top-level type) and every
 * top-level type by package and simple name. Package declarations give the
 * qualified names, so source roots and modules need no special handling.
 *
 * Per file:
 * - single-type, static and static-wildcard imports always refer to the file
 *   declaring the (outermost matching) type;
 * - a package wildcard import refers only to the types the file references;
 * - a bare type name is looked up in Java's shadowing order (JLS §6.4.1):
 *   types declared in the file, single-type imports, the same package, then
 *   wildcard imports. Names found nowhere (java.lang, type parameters,
 *   inherited member types) are dropped;
 * - anything naming a package not in the project is external, attributed to
 *   its package: the segments before the first capitalised one. A missing
 *   type in a project package (generated code) is dropped, not external.
 *
 * @module sourcevision/language/java-resolver
 */

import type {
  Capture,
  FileReferences,
  PackResolver,
  PackSourceFile,
  PreparedResolver,
  SourcePosition,
} from "./pack.js";

// ── Facts read from one file's captures ─────────────────────────────────────

interface JavaImport {
  /** Dotted name as captured: `a.b.C`, `a.b` for `a.b.*`, `a.b.C.m` for a static member. */
  readonly name: string;
  readonly isStatic: boolean;
  readonly isWildcard: boolean;
}

/** A reference in code: a simple name (`Order`) or a dotted one (`java.util.List`, `Map.Entry`). */
interface JavaReference {
  readonly segments: readonly string[];
}

interface JavaFileFacts {
  readonly path: string;
  /** "" for the default package. */
  readonly pkg: string;
  readonly imports: readonly JavaImport[];
  /** Qualified names (without the package) of every type declared in the file, nested included. */
  readonly declared: readonly string[];
  readonly references: readonly JavaReference[];
}

const DECLARATION_KINDS = new Set(["type.class", "type.interface", "type.enum", "type.record", "type.annotation"]);

function before(a: SourcePosition, b: SourcePosition): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

/** `inner` lies within `outer` (bounds inclusive). */
function within(inner: Capture, outer: Capture): boolean {
  return !before(inner.start, outer.start) && !before(outer.end, inner.end);
}

const startsWithCapital = (segment: string): boolean => /^[A-Z]/.test(segment);

/** `java.util.Map<K, V>.Entry` → `["java", "util", "Map", "Entry"]`; whitespace, comments and annotations dropped. */
function dottedSegments(text: string): string[] {
  let stripped = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  for (let prev = ""; prev !== stripped; ) {
    prev = stripped;
    stripped = stripped.replace(/<[^<>]*>/g, "");
  }
  return stripped
    .replace(/@[\w$.]+/g, "")
    .replace(/\s+/g, "")
    .split(".")
    .filter((s) => s.length > 0);
}

function readFacts(file: PackSourceFile): JavaFileFacts {
  const of = (query: string): readonly Capture[] => file.captures[query] ?? [];

  const pkgCapture = of("packages").find((c) => c.name === "package.name");
  const pkg = pkgCapture ? dottedSegments(pkgCapture.text).join(".") : "";

  const importCaptures = of("imports");
  const imports = importCaptures
    .filter((c) => c.name === "import.declaration")
    .flatMap((decl): JavaImport[] => {
      const inside = importCaptures.filter((c) => c !== decl && within(c, decl));
      const name = inside.find((c) => c.name === "import.name");
      if (!name) return [];
      return [
        {
          name: dottedSegments(name.text).join("."),
          isStatic: inside.some((c) => c.name === "import.static"),
          isWildcard: inside.some((c) => c.name === "import.wildcard"),
        },
      ];
    });

  // Declarations arrive in document order, each immediately followed by its name.
  const declared: string[] = [];
  const open: Array<{ readonly span: Capture; readonly qualified: string }> = [];
  const declCaptures = of("declarations");
  for (let i = 0; i + 1 < declCaptures.length; i++) {
    const span = declCaptures[i]!;
    const name = declCaptures[i + 1]!;
    if (!DECLARATION_KINDS.has(span.name) || name.name !== "type.name") continue;
    while (open.length > 0 && !within(span, open[open.length - 1]!.span)) open.pop();
    const parent = open[open.length - 1];
    const qualified = parent ? `${parent.qualified}.${name.text}` : name.text;
    declared.push(qualified);
    open.push({ span, qualified });
  }

  return { path: file.path, pkg, imports, declared, references: readReferences(file) };
}

function readReferences(file: PackSourceFile): JavaReference[] {
  const typeRefs = file.captures["type-references"] ?? [];
  const qualified = typeRefs.filter((c) => c.name === "typeref.qualified");
  const outermost = qualified.filter((q) => !qualified.some((o) => o !== q && within(q, o)));

  const references: JavaReference[] = outermost.map((q) => ({ segments: dottedSegments(q.text) }));
  // Simple names inside a scoped name are its segments, already read above
  // (this also drops type arguments of a generic qualifier, `Outer<String>.Inner`).
  for (const c of typeRefs) {
    if (c.name === "typeref.name" && !outermost.some((q) => within(c, q))) {
      references.push({ segments: [c.text] });
    } else if (c.name === "typeref.annotation") {
      references.push({ segments: dottedSegments(c.text) });
    } else if (c.name === "typeref.qualifier" && startsWithCapital(c.text)) {
      references.push({ segments: [c.text] });
    }
  }
  // `Tax.rate()`: a capitalised bare receiver is taken as a type.
  for (const c of file.captures["calls"] ?? []) {
    if (c.name === "call.receiver" && c.nodeType === "identifier" && startsWithCapital(c.text)) {
      references.push({ segments: [c.text] });
    }
  }
  return references.filter((r) => r.segments.length > 0);
}

// ── Project index ───────────────────────────────────────────────────────────

class Multimap {
  private readonly map = new Map<string, Set<string>>();

  add(key: string, value: string): void {
    let set = this.map.get(key);
    if (!set) this.map.set(key, (set = new Set()));
    set.add(value);
  }

  get(key: string): ReadonlySet<string> | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  entries(): IterableIterator<[string, Set<string>]> {
    return this.map.entries();
  }
}

interface JavaIndex {
  /** Fully qualified type name (nested included) → declaring files. */
  readonly types: Multimap;
  /** `package\0SimpleName` of each top-level type → declaring files. */
  readonly topLevel: Multimap;
  readonly packages: ReadonlySet<string>;
}

function buildIndex(facts: readonly JavaFileFacts[]): JavaIndex {
  const types = new Multimap();
  const topLevel = new Multimap();
  const packages = new Set<string>();
  for (const file of facts) {
    packages.add(file.pkg);
    for (const name of file.declared) {
      types.add(file.pkg ? `${file.pkg}.${name}` : name, file.path);
      if (!name.includes(".")) topLevel.add(`${file.pkg}\0${name}`, file.path);
    }
  }
  return { types, topLevel, packages };
}

/** The longest prefix of `segments` that names a project type, with its files. */
function longestType(index: JavaIndex, segments: readonly string[]): { files: ReadonlySet<string>; length: number } | undefined {
  for (let length = segments.length; length > 0; length--) {
    const files = index.types.get(segments.slice(0, length).join("."));
    if (files) return { files, length };
  }
  return undefined;
}

/** Package part of a dotted name: the segments before the first capitalised one. */
function packageOf(segments: readonly string[]): string {
  const firstType = segments.findIndex(startsWithCapital);
  return segments.slice(0, firstType === -1 ? segments.length - 1 : firstType).join(".");
}

// ── Per-file resolution ─────────────────────────────────────────────────────

class Collector {
  private readonly files = new Multimap();
  private readonly external = new Multimap();

  constructor(
    private readonly self: string,
    private readonly projectPackages: ReadonlySet<string>,
  ) {}

  file(paths: Iterable<string>, symbol: string): void {
    for (const path of paths) if (path !== this.self) this.files.add(path, symbol);
  }

  /** A package the project declares is never external, even when the type is missing (e.g. generated at build time). */
  externalPackage(pkg: string, symbol: string): void {
    if (pkg && !this.projectPackages.has(pkg)) this.external.add(pkg, symbol);
  }

  result(): FileReferences {
    const sorted = (map: Multimap) =>
      [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, set]) => [key, [...set].sort()] as const);
    return {
      files: sorted(this.files).map(([to, symbols]) => ({ to, symbols })),
      external: sorted(this.external).map(([pkg, symbols]) => ({ package: pkg, symbols })),
    };
  }
}

function resolveFile(index: JavaIndex, file: JavaFileFacts): FileReferences {
  const out = new Collector(file.path, index.packages);
  const declaredHere = new Set(file.declared.map((q) => q.slice(q.lastIndexOf(".") + 1)));
  const singles = new Map<string, readonly string[]>();
  const wildcards: string[][] = [];

  for (const imp of file.imports) {
    const segments = imp.name.split(".");
    if (imp.isWildcard && !imp.isStatic) {
      if (index.packages.has(imp.name) || index.types.has(imp.name)) wildcards.push(segments);
      else out.externalPackage(packageOf([...segments, "*"]), "*");
      continue;
    }
    const symbol = imp.isWildcard ? "*" : segments[segments.length - 1]!;
    if (!imp.isStatic) singles.set(symbol, segments);
    const found = longestType(index, segments);
    if (found) out.file(found.files, symbol);
    else out.externalPackage(packageOf(imp.isWildcard ? [...segments, "*"] : segments), symbol);
  }

  /** Resolve a simple name; true when it named something (in the project or not). */
  const resolveSimple = (name: string): boolean => {
    if (declaredHere.has(name)) return true;
    // Single-type imports were recorded above, whether resolved or external.
    if (singles.has(name)) return true;
    const samePackage = index.topLevel.get(`${file.pkg}\0${name}`);
    if (samePackage) {
      out.file(samePackage, name);
      return true;
    }
    let found = false;
    for (const segments of wildcards) {
      const prefix = segments.join(".");
      const files = index.types.has(prefix) ? index.types.get(`${prefix}.${name}`) : index.topLevel.get(`${prefix}\0${name}`);
      if (files) {
        out.file(files, name);
        found = true;
      }
    }
    return found;
  };

  for (const { segments } of file.references) {
    const head = segments[0]!;
    if (resolveSimple(head) || segments.length === 1) continue;
    // Fully qualified: `com.example.model.Customer`, `java.time.Instant`.
    const found = longestType(index, segments);
    if (found) out.file(found.files, segments[found.length - 1]!);
    else {
      const firstType = segments.find(startsWithCapital);
      if (firstType && !startsWithCapital(head)) out.externalPackage(packageOf(segments), firstType);
    }
  }

  return out.result();
}

// ── Resolver ────────────────────────────────────────────────────────────────

export const javaResolver: PackResolver = {
  prepare(files: readonly PackSourceFile[]): PreparedResolver {
    const facts = files.map(readFacts);
    const index = buildIndex(facts);
    const byPath = new Map(facts.map((f) => [f.path, f]));
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
