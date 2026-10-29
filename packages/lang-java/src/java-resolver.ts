/**
 * Java reference resolver: turns the Java pack's captures into file-to-file
 * references and external packages.
 *
 * `prepare` indexes every declared type by qualified name (nested types
 * included, each mapped to the file of its top-level type) and every
 * top-level type by package and simple name. Package declarations give the
 * qualified names. When several files declare one name, a reference keeps
 * the ones javac could link ({@link visibleCandidates}): its own module and
 * source set, read from the path (`<module>/src/<set>/java/`), never test
 * code from main code, and another module's test code only when the build
 * declares a test-jar or test-fixtures dependency on it ({@link javaResolver.forProject}).
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
 *   its package: the segments before the first capitalised one, named
 *   `java:<package>` so it never merges with another pack's external of the
 *   same name. JDK packages are `java:stdlib:<package>` ({@link isJdkPackage}).
 *   A missing type in a project package (generated code) is dropped, not
 *   external.
 *
 * @module lang-java/java-resolver
 */

import type {
  Capture,
  FileReferences,
  PackResolver,
  PackSourceFile,
  PreparedResolver,
  SourcePosition,
} from "@n-dx/lang-runtime";
import { innermostEach } from "@n-dx/lang-runtime";
import { readTestArtifactGrants, type TestArtifactGrants } from "./java-test-artifacts.js";

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
  readonly capture: Capture;
  readonly owner?: string;
}

interface JavaFileFacts {
  readonly path: string;
  /** "" for the default package. */
  readonly pkg: string;
  readonly imports: readonly JavaImport[];
  /** Qualified names (without the package) of every type declared in the file, nested included. */
  readonly declared: readonly string[];
  readonly heritage: readonly { readonly name: string; readonly bases: readonly string[][] }[];
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

/** Spans not contained in another span, in document order: one sweep over spans sorted by start, then widest first. */
function outermostSpans(spans: readonly Capture[]): Capture[] {
  const sorted = [...spans].sort((a, b) => {
    if (before(a.start, b.start)) return -1;
    if (before(b.start, a.start)) return 1;
    if (before(b.end, a.end)) return -1;
    return before(a.end, b.end) ? 1 : 0;
  });
  const result: Capture[] = [];
  for (const span of sorted) {
    const last = result[result.length - 1];
    if (!last || !within(span, last)) result.push(span);
  }
  return result;
}

/** `c` lies within one of `outer` (disjoint, in document order): binary search for the last span starting at or before it. */
function insideAny(c: Capture, outer: readonly Capture[]): boolean {
  let lo = 0;
  let hi = outer.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (before(c.start, outer[mid]!.start)) hi = mid;
    else lo = mid + 1;
  }
  return lo > 0 && within(c, outer[lo - 1]!);
}

const startsWithCapital = (segment: string): boolean => /^[A-Z]/.test(segment);

/**
 * `java.util.Map<K, V>.Entry` → `["java", "util", "Map", "Entry"]`; whitespace, comments and annotations dropped.
 * Linear on any text, because capture text comes from the repository under analysis.
 */
export function dottedSegments(text: string): string[] {
  return eraseGenerics(stripComments(text))
    .replace(/@[\w$.]+/g, "")
    .replace(/\s+/g, "")
    .split(".")
    .filter((s) => s.length > 0);
}

/**
 * Drop block and line comments in one left-to-right scan. An unterminated block
 * opener stays as text; once one search for a closer fails, no later one can succeed.
 */
function stripComments(text: string): string {
  let out = "";
  let from = 0;
  let closerAhead = true;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== "/") continue;
    let end = -1;
    if (text[i + 1] === "*") {
      if (closerAhead) {
        const close = text.indexOf("*/", i + 2);
        if (close < 0) closerAhead = false;
        else end = close + 2;
      }
    } else if (text[i + 1] === "/") {
      const newline = text.indexOf("\n", i + 2);
      end = newline < 0 ? text.length : newline;
    }
    if (end < 0) continue;
    out += text.slice(from, i);
    from = end;
    i = end - 1;
  }
  return out + text.slice(from);
}

/**
 * Drop every character inside balanced `<…>`, nesting included, in one pass;
 * unbalanced brackets stay. Each `>` closes the nearest open `<`, as repeatedly
 * removing innermost `<[^<>]*>` pairs does.
 */
function eraseGenerics(text: string): string {
  const out: string[] = [];
  const open: number[] = [];
  for (const ch of text) {
    if (ch === ">" && open.length > 0) {
      out.length = open.pop()!;
      continue;
    }
    if (ch === "<") open.push(out.length);
    out.push(ch);
  }
  return out.join("");
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
  const declarations: Array<{ span: Capture; name: string }> = [];
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
    declarations.push({ span, name: qualified });
    open.push({ span, qualified });
  }

  const typeRefs = of("type-references");
  const bases = typeRefs.filter((c) => c.name === "typeref.extends" || c.name === "typeref.implements");
  const baseOwners = innermostEach(declarations.map((d) => d.span), bases);
  const nameOf = new Map(declarations.map((d) => [d.span, d.name]));
  const inherited = new Map<string, string[][]>();
  bases.forEach((base, i) => {
    const owner = baseOwners[i];
    const name = owner && nameOf.get(owner);
    if (name) {
      const list = inherited.get(name) ?? [];
      list.push(dottedSegments(base.text));
      inherited.set(name, list);
    }
  });
  const references = readReferences(file);
  const owners = innermostEach(declarations.map((d) => d.span), references.map((r) => r.capture));
  return {
    path: file.path, pkg, imports, declared,
    heritage: declarations.map((d) => ({ name: d.name, bases: inherited.get(d.name) ?? [] })),
    references: references.map((r, i) => {
      const owner = owners[i] && nameOf.get(owners[i]!);
      return { ...r, ...(owner ? { owner: pkg ? `${pkg}.${owner}` : owner } : {}) };
    }),
  };
}

function readReferences(file: PackSourceFile): JavaReference[] {
  const typeRefs = file.captures["type-references"] ?? [];
  const qualified = typeRefs.filter((c) => c.name === "typeref.qualified");
  const outermost = outermostSpans(qualified);

  const references: JavaReference[] = outermost.map((q) => ({ segments: dottedSegments(q.text), capture: q }));
  // Simple names inside a scoped name are its segments, already read above
  // (this also drops type arguments of a generic qualifier, `Outer<String>.Inner`).
  for (const c of typeRefs) {
    if (c.name === "typeref.name" && !insideAny(c, outermost)) {
      references.push({ segments: [c.text], capture: c });
    } else if (c.name === "typeref.annotation") {
      references.push({ segments: dottedSegments(c.text), capture: c });
    } else if (c.name === "typeref.qualifier" && startsWithCapital(c.text)) {
      references.push({ segments: [c.text], capture: c });
    }
  }
  // `Tax.rate()`: a capitalised bare receiver is taken as a type.
  for (const c of file.captures["calls"] ?? []) {
    if (c.name === "call.receiver" && c.nodeType === "identifier" && startsWithCapital(c.text)) {
      references.push({ segments: [c.text], capture: c });
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

/** Where a file sits in a Maven/Gradle layout: `<module>/src/<set>/java/…`. */
interface SourceLocation {
  /** Module directory, "" for the project root. */
  readonly module: string;
  /** Source set: `main`, `test`, `integrationTest`, … */
  readonly set: string;
  readonly isTest: boolean;
}

const SOURCE_SET_DIR = /(?:^|\/)src\/([^/]+)\/java\//;

/** A test source set: any name containing `test` (`test`, `integrationTest`, `testFixtures`), or Maven Failsafe's `it`. */
const isTestSet = (set: string): boolean => set === "it" || /test/i.test(set);

/** Undefined outside the standard layout (custom source roots), where no candidate is narrowed. */
function sourceLocation(path: string): SourceLocation | undefined {
  const match = SOURCE_SET_DIR.exec(path);
  if (!match) return undefined;
  const set = match[1]!;
  return { module: path.slice(0, match.index), set, isTest: isTestSet(set) };
}

interface JavaIndex {
  /** Fully qualified type name (nested included) → declaring files. */
  readonly types: Multimap;
  /** `package\0SimpleName` of each top-level type → declaring files. */
  readonly topLevel: Multimap;
  readonly packages: ReadonlySet<string>;
  /** Each file's {@link SourceLocation}, absent outside the standard layout. */
  readonly locations: ReadonlyMap<string, SourceLocation>;
  /** Other modules' test sets each module's tests see, from the build files. */
  readonly testGrants: TestArtifactGrants;
  /** Qualified type → its directly declared project supertypes. */
  readonly bases: ReadonlyMap<string, ReadonlySet<string>>;
}

function buildIndex(facts: readonly JavaFileFacts[], testGrants: TestArtifactGrants): JavaIndex {
  const types = new Multimap();
  const topLevel = new Multimap();
  const packages = new Set<string>();
  const locations = new Map<string, SourceLocation>();
  for (const file of facts) {
    packages.add(file.pkg);
    const location = sourceLocation(file.path);
    if (location) locations.set(file.path, location);
    for (const name of file.declared) {
      types.add(file.pkg ? `${file.pkg}.${name}` : name, file.path);
      if (!name.includes(".")) topLevel.add(`${file.pkg}\0${name}`, file.path);
    }
  }
  const bases = new Map<string, Set<string>>();
  for (const file of facts) {
    for (const declaration of file.heritage) {
      const owner = file.pkg ? `${file.pkg}.${declaration.name}` : declaration.name;
      const direct = bases.get(owner) ?? new Set<string>();
      for (const segments of declaration.bases) {
        const head = segments[0]!;
        const single = file.imports.find((i) => !i.isWildcard && !i.isStatic && i.name.split(".").at(-1) === head);
        const enclosing = declaration.name.split(".").slice(0, -1);
        const lexical: string[] = [];
        while (enclosing.length > 0) {
          lexical.push([file.pkg, ...enclosing, ...segments].filter(Boolean).join("."));
          enclosing.pop();
        }
        const candidates = [
          ...lexical,
          ...(single ? [[single.name, ...segments.slice(1)].join(".")] : []),
          file.pkg ? `${file.pkg}.${segments.join(".")}` : segments.join("."),
          ...(segments.length > 1 ? [segments.join(".")] : []),
          ...file.imports.filter((i) => i.isWildcard && !i.isStatic).map((i) => `${i.name}.${segments.join(".")}`),
        ];
        const found = candidates.find((name) => types.has(name));
        if (found) direct.add(found);
      }
      bases.set(owner, direct);
    }
  }
  return { types, topLevel, packages, locations, testGrants, bases };
}

/**
 * The declarations of one name that `from` can see, as javac would: main code
 * never sees test code, and test code sees its own module's, plus another
 * module's test sets its build grants ({@link TestArtifactGrants}: a Maven
 * test-jar, a Gradle `testFixtures` or test-configuration dependency); of the
 * rest, those in `from`'s own module, and of those, the ones in its own source
 * set (a test sees main code only when its own set has none). Several remain
 * only on a real tie, or when none is in `from`'s module. A file outside the
 * standard layout narrows nothing.
 */
function visibleCandidates(index: JavaIndex, from: string, candidates: ReadonlySet<string>): Iterable<string> {
  const here = index.locations.get(from);
  if (!here) return candidates;
  const granted = index.testGrants.get(here.module);
  const visible = [...candidates].filter((path) => {
    const there = index.locations.get(path);
    if (!there?.isTest) return true;
    if (!here.isTest) return false;
    return there.module === here.module || granted?.get(there.module)?.has(there.set) === true;
  });
  if (visible.length <= 1) return visible;
  const sameModule = visible.filter((path) => index.locations.get(path)?.module === here.module);
  if (sameModule.length === 0) return visible;
  const sameSet = sameModule.filter((path) => index.locations.get(path)!.set === here.set);
  return sameSet.length > 0 ? sameSet : sameModule;
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

// ── External names ──────────────────────────────────────────────────────────

/** Starts every external the pack emits, so Maven and JDK names never merge with another pack's. */
const JAVA_EXTERNAL_PREFIX = "java:";

/**
 * The `javax` packages the JDK (21) exports. The rest of `javax` (`javax.inject`,
 * `javax.persistence`, `javax.servlet`, and `javax.annotation` and `javax.xml.bind`
 * since JDK 11) ships as separate artifacts, so a `javax.` prefix alone is not enough.
 */
const JDK_JAVAX_PACKAGES = [
  "javax.accessibility",
  "javax.annotation.processing",
  "javax.crypto",
  "javax.imageio",
  "javax.lang.model",
  "javax.management",
  "javax.naming",
  "javax.net",
  "javax.print",
  "javax.rmi.ssl",
  "javax.script",
  "javax.security.auth",
  "javax.security.cert",
  "javax.security.sasl",
  "javax.smartcardio",
  "javax.sound",
  "javax.sql",
  "javax.swing",
  "javax.tools",
  "javax.transaction.xa",
  "javax.xml.catalog",
  "javax.xml.crypto",
  "javax.xml.datatype",
  "javax.xml.namespace",
  "javax.xml.parsers",
  "javax.xml.stream",
  "javax.xml.transform",
  "javax.xml.validation",
  "javax.xml.xpath",
];

/** Java EE packages nested under a {@link JDK_JAVAX_PACKAGES} root: JASPIC and JSR 77. */
const JAVA_EE_UNDER_JDK_ROOTS = ["javax.security.auth.message", "javax.management.j2ee"];

/** Additional packages exported by JDK modules, rather than third-party com.sun artifacts. */
const JDK_OTHER_PACKAGES = [
  "org.w3c.dom", "org.xml.sax", "org.ietf.jgss", "com.sun.net.httpserver",
  "com.sun.management", "com.sun.nio.sctp", "com.sun.security.auth", "com.sun.jdi",
  "sun.misc", "sun.reflect",
];

const isUnder = (pkg: string, root: string): boolean => pkg === root || pkg.startsWith(`${root}.`);

/** `java.*` and `jdk.*` (reserved to the JDK), `javax.xml`, and the {@link JDK_JAVAX_PACKAGES} and their subpackages. */
function isJdkPackage(pkg: string): boolean {
  if (isUnder(pkg, "java") || isUnder(pkg, "jdk") || pkg === "javax.xml") return true;
  if (JAVA_EE_UNDER_JDK_ROOTS.some((root) => isUnder(pkg, root))) return false;
  return [...JDK_JAVAX_PACKAGES, ...JDK_OTHER_PACKAGES].some((root) => isUnder(pkg, root));
}

/** `java.util` → `java:stdlib:java.util`, `org.acme` → `java:org.acme`. */
function externalName(pkg: string): string {
  return isJdkPackage(pkg) ? `${JAVA_EXTERNAL_PREFIX}stdlib:${pkg}` : `${JAVA_EXTERNAL_PREFIX}${pkg}`;
}

// ── Per-file resolution ─────────────────────────────────────────────────────

class Collector {
  private readonly files = new Multimap();
  private readonly external = new Multimap();

  constructor(
    private readonly self: string,
    private readonly index: JavaIndex,
  ) {}

  /** Narrowed before `self` is dropped, so a declaration in this file shadows a duplicate elsewhere. */
  file(candidates: ReadonlySet<string>, symbol: string): boolean {
    let visible = false;
    for (const path of visibleCandidates(this.index, this.self, candidates)) {
      visible = true;
      if (path !== this.self) this.files.add(path, symbol);
    }
    return visible;
  }

  /** A package the project declares is never external, even when the type is missing (e.g. generated at build time). */
  externalPackage(pkg: string, symbol: string): void {
    if (pkg && !this.index.packages.has(pkg)) this.external.add(externalName(pkg), symbol);
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
  const out = new Collector(file.path, index);
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
  const inherited = new Map<string, ReadonlySet<string>>();
  const inheritedFiles = (owner: string, name: string): ReadonlySet<string> => {
    const key = `${owner}\0${name}`;
    const cached = inherited.get(key);
    if (cached) return cached;
    const seen = new Set<string>([owner]);
    let next = [...(index.bases.get(owner) ?? [])];
    const found = new Set<string>();
    while (next.length > 0 && found.size === 0) {
      const following: string[] = [];
      for (const base of next) {
        if (seen.has(base)) continue;
        seen.add(base);
        for (const path of index.types.get(`${base}.${name}`) ?? []) found.add(path);
        following.push(...(index.bases.get(base) ?? []));
      }
      next = following;
    }
    inherited.set(key, found);
    return found;
  };
  const resolveSimple = (name: string, owner?: string): boolean => {
    if (declaredHere.has(name)) return true;
    if (owner && out.file(inheritedFiles(owner, name), name)) return true;
    // Single-type imports were recorded above, whether resolved or external.
    if (singles.has(name)) return true;
    const samePackage = index.topLevel.get(`${file.pkg}\0${name}`);
    if (samePackage && out.file(samePackage, name)) return true;
    let found = false;
    for (const segments of wildcards) {
      const prefix = segments.join(".");
      const files = index.types.has(prefix) ? index.types.get(`${prefix}.${name}`) : index.topLevel.get(`${prefix}\0${name}`);
      if (files) {
        found = out.file(files, name) || found;
      }
    }
    return found;
  };

  for (const { segments, owner } of file.references) {
    const head = segments[0]!;
    if (resolveSimple(head, owner) || segments.length === 1) continue;
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

function prepareJava(
  files: readonly PackSourceFile[],
  testGrants: TestArtifactGrants,
  notices: readonly string[] = [],
): PreparedResolver {
  const facts = files.map(readFacts);
  const index = buildIndex(facts, testGrants);
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
    notices: () => notices,
  };
}

const NO_GRANTS: TestArtifactGrants = new Map();

/**
 * The Java resolver. Without {@link PackResolver.forProject} it reads no
 * build file, so a test never links to another module's test code;
 * `forProject` reads the test-jar and test-fixtures dependencies that allow it.
 * Build files that cannot be read cost only those links: the resolver binds
 * without them and names the failure in its notices, so every other edge resolves.
 */
export const javaResolver: PackResolver = {
  prepare: (files) => prepareJava(files, NO_GRANTS),
  async forProject(projectDir) {
    let grants: TestArtifactGrants;
    try {
      grants = await readTestArtifactGrants(projectDir);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const notice = `Java: the build files could not be read (${reason}); no test links to another module's test code.`;
      return { prepare: (files) => prepareJava(files, NO_GRANTS, [notice]) };
    }
    return { prepare: (files) => prepareJava(files, grants) };
  },
};
