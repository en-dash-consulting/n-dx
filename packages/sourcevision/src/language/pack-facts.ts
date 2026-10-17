/**
 * The adapter from a pack's captures to lang-kit's per-file facts.
 *
 * Tree-sitter stays a helper inside sourcevision: the runner yields captures,
 * and this module reads them into the facts-out contract (`FileFacts`) that
 * the rest of sourcevision consumes. Each fact kind a pack lists in
 * `produces` is read here:
 *
 * - `imports` — the pack resolver's `FileReferences` for the file, unchanged.
 *   Resolution needs the whole project, so the caller passes the resolver it
 *   prepared over every file.
 * - `symbols` — declarations, by the rules in {@link SYMBOL_RULES}.
 * - `calls` — the `calls` query, grouped by `groupCalls`.
 *
 * SQL's only query names tables. A `CREATE TABLE` is a symbol of kind
 * `table`: its name is the unquoted last part of the object reference, its
 * container the schema (the part before it), and its span the reference's
 * span. An `ALTER TABLE` declares nothing, so it is not a symbol;
 * `sql-schema.ts` still reads both statements from the captures.
 *
 * @module sourcevision/language/pack-facts
 */

import type { FactKind, FileFacts, SourceSpan, SymbolFact, SymbolKind } from "@n-dx/lang-kit";
import { groupCalls, innermost } from "./pack-calls.js";
import { splitSqlName } from "./sql-schema.js";
import type { Capture, LanguagePack, PackSourceFile, PreparedResolver } from "./pack.js";

/** How one declaration capture becomes a symbol. */
interface SymbolRule {
  /** Query whose captures hold the declaration. */
  readonly query: string;
  /** Capture spanning the whole declaration. */
  readonly declaration: string;
  /** Capture holding the name, inside the declaration; may be the declaration itself. */
  readonly name: string;
  readonly kind: SymbolKind;
  /** Capture inside the declaration whose text is the symbol's container. */
  readonly container?: string;
  /** Turns the name capture's text into a name and container; defaults to the text as written. */
  readonly read?: (text: string) => { readonly name: string; readonly container?: string } | undefined;
}

const typeRule = (query: string, declaration: string, kind: SymbolKind): SymbolRule => ({
  query,
  declaration,
  name: "type.name",
  kind,
});

/** Declaration rules per pack id, written against `queries/<lang>/*.scm`. */
export const SYMBOL_RULES: Readonly<Record<string, readonly SymbolRule[]>> = {
  java: [
    typeRule("declarations", "type.class", "class"),
    typeRule("declarations", "type.interface", "interface"),
    typeRule("declarations", "type.enum", "enum"),
    typeRule("declarations", "type.record", "record"),
    typeRule("declarations", "type.annotation", "annotation"),
    { query: "methods", declaration: "method.declaration", name: "method.name", kind: "method" },
    { query: "methods", declaration: "constructor.declaration", name: "constructor.name", kind: "constructor" },
  ],
  go: [
    typeRule("types", "type.struct", "struct"),
    typeRule("types", "type.interface", "interface"),
    typeRule("types", "type.alias", "alias"),
    { query: "functions", declaration: "function.declaration", name: "function.name", kind: "function" },
    {
      query: "methods",
      declaration: "method.declaration",
      name: "method.name",
      kind: "method",
      container: "method.receiver_type",
    },
  ],
  sql: [
    {
      query: "tables",
      declaration: "create.table",
      name: "create.table",
      kind: "table",
      read: (text) => {
        const parts = splitSqlName(text);
        const name = parts.at(-1);
        const schema = parts.length > 1 ? parts.at(-2) : undefined;
        if (name === undefined) return undefined;
        return schema === undefined ? { name } : { name, container: schema };
      },
    },
  ],
};

/**
 * Captures that bound a type without declaring a symbol, per pack id: a member
 * inside one has no named container, rather than the named type around it.
 */
const ANONYMOUS_BODIES: Readonly<Record<string, { readonly query: string; readonly capture: string }>> = {
  java: { query: "declarations", capture: "anonymous.body" },
};

/** Kinds whose symbols contain members: a member without an explicit container belongs to the nearest one. */
const TYPE_KINDS: ReadonlySet<SymbolKind> = new Set(["class", "interface", "enum", "record", "annotation", "struct"]);

const span = (capture: Capture): SourceSpan => ({ start: capture.start, end: capture.end });

const before = (a: SourceSpan["start"], b: SourceSpan["start"]): number => a.line - b.line || a.column - b.column;

const within = (outer: SourceSpan, inner: SourceSpan): boolean =>
  before(outer.start, inner.start) <= 0 && before(inner.end, outer.end) <= 0;

const IMPORTS_GAP = 'has a resolver but does not produce "imports"';
const SYMBOLS_GAP = 'produces "symbols" but has no symbol rules';

/**
 * Where a pack's `produces` disagrees with what this adapter can read for it:
 * a resolver whose imports would never be read, or symbols with no
 * {@link SYMBOL_RULES} entry. Empty for a consistent pack.
 */
export function factGaps(pack: LanguagePack): string[] {
  return [
    ...(pack.resolver !== undefined && !pack.produces.includes("imports") ? [IMPORTS_GAP] : []),
    ...(pack.produces.includes("symbols") && SYMBOL_RULES[pack.id] === undefined ? [SYMBOLS_GAP] : []),
  ];
}

/**
 * The symbols a file declares, in document order of their declarations.
 * Throws for a pack without symbol rules: an empty list would read as
 * "declares nothing".
 */
export function readSymbols(pack: LanguagePack, file: PackSourceFile): SymbolFact[] {
  const rules = SYMBOL_RULES[pack.id];
  if (rules === undefined) throw new Error(`${pack.id}: ${SYMBOLS_GAP}`);
  const symbols: SymbolFact[] = [];
  for (const query of new Set(rules.map((r) => r.query))) {
    const captures = file.captures[query] ?? [];
    const queryRules = rules.filter((r) => r.query === query);
    const ruleOf = new Map(queryRules.map((r) => [r.declaration, r]));
    const declarations = captures.filter((c) => ruleOf.has(c.name));
    const parts = new Set(queryRules.flatMap((r) => (r.container ? [r.name, r.container] : [r.name])));

    // Each name (and container) belongs to the innermost declaration around it,
    // so a nested type or a local class never lends its name to the outer one.
    const owned = new Map<Capture, Capture[]>();
    for (const capture of captures) {
      if (!parts.has(capture.name)) continue;
      const owner = innermost(declarations, capture);
      if (owner) owned.set(owner, [...(owned.get(owner) ?? []), capture]);
    }

    for (const declaration of declarations) {
      const rule = ruleOf.get(declaration.name)!;
      const inside = owned.get(declaration) ?? [];
      const nameCapture = inside.find((c) => c.name === rule.name);
      if (!nameCapture) continue;
      const read = rule.read ? rule.read(nameCapture.text) : { name: nameCapture.text };
      if (!read) continue;
      const container = read.container ?? (rule.container ? inside.find((c) => c.name === rule.container)?.text : undefined);
      symbols.push({
        name: read.name,
        kind: rule.kind,
        position: nameCapture.start,
        span: span(declaration),
        ...(container === undefined ? {} : { container }),
      });
    }
  }

  symbols.sort((a, b) => before(a.span.start, b.span.start));
  const anonymous = ANONYMOUS_BODIES[pack.id];
  const bodies = anonymous ? (file.captures[anonymous.query] ?? []).filter((c) => c.name === anonymous.capture) : [];
  return symbols.map((symbol) => {
    if (symbol.container !== undefined) return symbol;
    let enclosing: SymbolFact | undefined;
    for (const other of symbols) {
      if (other === symbol || !TYPE_KINDS.has(other.kind) || !within(other.span, symbol.span)) continue;
      if (enclosing === undefined || within(enclosing.span, other.span)) enclosing = other;
    }
    // An anonymous body between the symbol and its named type makes it no member of that type.
    const cut = bodies.some((b) => within(span(b), symbol.span) && (enclosing === undefined || within(enclosing.span, span(b))));
    return enclosing && !cut ? { ...symbol, container: enclosing.name } : symbol;
  });
}

export interface ReadFactsOptions {
  /** Kinds to read; defaults to everything the pack produces. A kind the pack does not produce stays absent. */
  readonly kinds?: readonly FactKind[];
  /** The pack's resolver, prepared over the whole project. `imports` is read only when it is given. */
  readonly resolver?: PreparedResolver;
}

/** Read one parsed file's captures into lang-kit's per-file facts. */
export function readPackFacts(pack: LanguagePack, file: PackSourceFile, options: ReadFactsOptions = {}): FileFacts {
  const wanted = new Set(options.kinds ?? pack.produces);
  const reads = (kind: FactKind): boolean => wanted.has(kind) && pack.produces.includes(kind);
  return {
    path: file.path,
    ...(reads("imports") && options.resolver ? { imports: options.resolver.resolve(file.path) } : {}),
    ...(reads("symbols") ? { symbols: readSymbols(pack, file) } : {}),
    ...(reads("calls") ? { calls: groupCalls(file.captures.calls ?? []) } : {}),
  };
}
