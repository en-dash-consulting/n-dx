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
  const outermost = outermostSpans(qualified);

  const references: JavaReference[] = outermost.map((q) => ({ segments: dottedSegments(q.text) }));
  // Simple names inside a scoped name are its segments, already read above
  // (this also drops type arguments of a generic qualifier, `Outer<String>.Inner`).
  for (const c of typeRefs) {
    if (c.name === "typeref.name" && !insideAny(c, outermost)) {
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
  return { types, topLevel, packages, locations, testGrants };
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

const isUnder = (pkg: string, root: string): boolean => pkg === root || pkg.startsWith(`${root}.`);

/** `java.*` and `jdk.*` (reserved to the JDK), `javax.xml`, and the {@link JDK_JAVAX_PACKAGES} and their subpackages. */
function isJdkPackage(pkg: string): boolean {
  if (isUnder(pkg, "java") || isUnder(pkg, "jdk") || pkg === "javax.xml") return true;
  if (JAVA_EE_UNDER_JDK_ROOTS.some((root) => isUnder(pkg, root))) return false;
  return JDK_JAVAX_PACKAGES.some((root) => isUnder(pkg, root));
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
  file(candidates: ReadonlySet<string>, symbol: string): void {
    for (const path of visibleCandidates(this.index, this.self, candidates)) {
      if (path !== this.self) this.files.add(path, symbol);
    }
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

function prepareJava(files: readonly PackSourceFile[], testGrants: TestArtifactGrants): PreparedResolver {
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
  };
}

const NO_GRANTS: TestArtifactGrants = new Map();

/**
 * The Java resolver. Without {@link PackResolver.forProject} it reads no
 * build file, so a test never links to another module's test code;
 * `forProject` reads the test-jar and test-fixtures dependencies that allow it.
 */
export const javaResolver: PackResolver = {
  prepare: (files) => prepareJava(files, NO_GRANTS),
  async forProject(projectDir) {
    const grants = await readTestArtifactGrants(projectDir);
    return { prepare: (files) => prepareJava(files, grants) };
  },
};
