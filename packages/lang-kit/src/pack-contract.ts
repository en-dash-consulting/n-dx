/**
 * The pack contract: the facts a language pack returns for one file.
 *
 * A pack's contract is facts out. How a pack finds them (a parser, queries, a
 * resolver over the whole project) is its own business and appears nowhere
 * here; consumers read only {@link FileFacts}. Every fact kind is an optional
 * field, so a pack fills the kinds it produces and leaves the rest absent.
 *
 * Fact kinds are split in two. Produced kinds have a pack filling them today.
 * Declared kinds are typed now so the packs that will fill them can do so
 * without a change to this contract; nothing produces them yet. Build facts
 * are not a fact kind: a build file's model is `ModuleBuildModel`
 * (`build-model.ts`).
 *
 * @module lang-kit/pack-contract
 */

// ── Positions ───────────────────────────────────────────────────────────────

/** A position in a file. */
export interface SourcePosition {
  /** One-based line. */
  readonly line: number;
  /**
   * Zero-based column in UTF-16 code units: it indexes the line as
   * `String.prototype` methods do, not by UTF-8 byte.
   */
  readonly column: number;
}

/** A range in a file; `end` is exclusive. */
export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

// ── Imports (produced) ──────────────────────────────────────────────────────

/** A project file one file refers to, with the names that led there. */
export interface FileReference {
  /**
   * Project-relative path of the target file. A language whose imports name a
   * package directory (Go) gives the directory; the zones phase expands it to
   * the files beneath (`resolveEdgeTarget` in `analyzers/zones.ts`).
   */
  readonly to: string;
  /** Sorted, distinct; `*` for a wildcard import. */
  readonly symbols: readonly string[];
}

/** The build-system module an external package comes from, when the resolver knows it. */
export interface ExternalModule {
  readonly path: string;
  readonly version?: string;
}

/** A package outside the project that one file refers to. */
export interface ExternalReference {
  /** Package name, e.g. `java.util`. No version. */
  readonly package: string;
  /** Sorted, distinct; `*` for a wildcard import. */
  readonly symbols: readonly string[];
  /** Held in memory only; the imports schema has no field for it. */
  readonly module?: ExternalModule;
}

/** Everything one file refers to. Both lists are sorted and deduplicated. */
export interface FileReferences {
  /** Never contains the file itself. */
  readonly files: readonly FileReference[];
  readonly external: readonly ExternalReference[];
}

// ── Symbols (produced) ──────────────────────────────────────────────────────

/**
 * What a declared symbol is. Language terms are kept rather than mapped onto
 * one another: a Go `struct` is not reported as a `class`.
 *
 * - `class`, `interface`, `enum`, `record`, `annotation`: Java type declarations
 *   (`annotation` is an `@interface`). Go's `interface` uses the same kind.
 * - `struct`, `alias`: Go `type S struct{…}` and `type A = B`.
 * - `function`, `method`, `constructor`: callables. A Go method's container is
 *   its receiver's base type; a Java method's is its enclosing type.
 * - `table`: a SQL table created by `CREATE TABLE`.
 */
export const SYMBOL_KINDS = [
  "class",
  "interface",
  "enum",
  "record",
  "annotation",
  "struct",
  "alias",
  "function",
  "method",
  "constructor",
  "table",
] as const;

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

/** A type, callable or table a file declares. */
export interface SymbolFact {
  /** Simple name as declared, unquoted (`Owner`, `ServeHTTP`, `owners`). */
  readonly name: string;
  readonly kind: SymbolKind;
  /** Where the name starts. */
  readonly position: SourcePosition;
  /** The whole declaration, from its first token (modifiers included) to its last. */
  readonly span: SourceSpan;
  /**
   * The type a member belongs to (a method's enclosing class, a Go method's
   * receiver base type, a nested type's outer type) or a table's schema.
   * Absent at top level, and for a Java member of an anonymous class: it
   * belongs to no named type, so it does not take the one around it.
   */
  readonly container?: string;
}

// ── Calls (produced) ────────────────────────────────────────────────────────

/** A string literal passed directly as a call argument. */
export interface StringArgument {
  /** The literal as written, quotes (or text-block delimiters) included. */
  readonly text: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

/** One call site. Calls are listed in the order their argument lists open. */
export interface CallFact {
  /** Called method or function; absent when the callee is not a name (`f()()`). */
  readonly callee?: string;
  /** Receiver as written (`jdbcTemplate`, `s.db`); absent for an unqualified call. */
  readonly receiver?: string;
  /**
   * String literals passed directly to this call, in order. A literal inside a
   * nested call belongs to that call: `f(g("x"))` gives `"x"` to `g`.
   */
  readonly strings: readonly StringArgument[];
}

// ── Declared kinds (no pack produces them yet) ──────────────────────────────

/** A request route a file serves (a Spring `@GetMapping`, a Go `mux.HandleFunc`). */
export interface RouteFact {
  /** Upper-case HTTP method; absent when the route accepts any method. */
  readonly method?: string;
  /** The path pattern as declared, e.g. `/owners/{id}`. */
  readonly path: string;
  /** Name of the function or method that handles it, when known. */
  readonly handler?: string;
  readonly position: SourcePosition;
}

/** A framework-managed unit a file declares (a React component, a Spring bean). */
export interface ComponentFact {
  readonly name: string;
  /** The framework's own term for it, e.g. `react-component`, `spring-service`. */
  readonly kind: string;
  readonly position: SourcePosition;
}

/** A call that leaves the process. Mirrors sourcevision's outbound dependency, per file. */
export interface OutboundCallFact {
  readonly kind: "http" | "grpc" | "queue" | "database" | "cache" | "env";
  /**
   * Where the call points: a URL or address when `targetSource` is `literal`,
   * the variable's name for `env`, the key for `config`, `""` for `unknown`.
   */
  readonly target: string;
  readonly targetSource: "literal" | "env" | "config" | "unknown";
  /** The client making the call: `fetch`, `RestTemplate`, `pgx`, … */
  readonly client: string;
  readonly position: SourcePosition;
}

/**
 * A piece of infrastructure an IaC file declares. The coarse kind (bucket,
 * queue, …) is not part of the fact: consumers classify `type` with
 * `IAC_KINDS` (`iac-kinds.ts`).
 */
export interface ResourceFact {
  /** Resource type as declared, e.g. `aws_db_instance`. */
  readonly type: string;
  /** The declaration's local name, e.g. `main` in `resource "aws_db_instance" "main"`. */
  readonly name: string;
  /** Names the resource is known by at run time (a `name` attribute), for matching source. */
  readonly literals?: readonly string[];
  readonly position: SourcePosition;
}

// ── Per-file facts ──────────────────────────────────────────────────────────

/** Everything a pack reports about one file. A kind the pack does not produce is absent. */
export interface FileFacts {
  /** Project-relative, forward-slash path. */
  readonly path: string;
  readonly imports?: FileReferences;
  /** In document order. */
  readonly symbols?: readonly SymbolFact[];
  readonly calls?: readonly CallFact[];
  readonly routes?: readonly RouteFact[];
  readonly components?: readonly ComponentFact[];
  readonly outboundCalls?: readonly OutboundCallFact[];
  readonly resources?: readonly ResourceFact[];
}

/** Fact kinds a pack produces today. */
export const PRODUCED_FACT_KINDS = ["imports", "symbols", "calls"] as const;

/** Fact kinds typed in this contract that no pack produces yet. */
export const DECLARED_FACT_KINDS = ["routes", "components", "outboundCalls", "resources"] as const;

export type ProducedFactKind = (typeof PRODUCED_FACT_KINDS)[number];
export type DeclaredFactKind = (typeof DECLARED_FACT_KINDS)[number];
/** A field of {@link FileFacts} other than `path`. */
export type FactKind = ProducedFactKind | DeclaredFactKind;

/** Every fact kind, produced first. */
export const FACT_KINDS: readonly FactKind[] = [...PRODUCED_FACT_KINDS, ...DECLARED_FACT_KINDS];

/** True when `value` names a fact kind. */
export function isFactKind(value: string): value is FactKind {
  return (FACT_KINDS as readonly string[]).includes(value);
}

/** What a pack says about its output: the fact kinds it fills. */
export interface FactProducer {
  readonly produces: readonly FactKind[];
}
