/**
 * The adapter from a pack's captures to lang-kit's per-file facts.
 *
 * Tree-sitter stays inside the runtime: the runner yields captures, and this
 * module reads them into the facts-out contract (`FileFacts`) that callers
 * consume. Each fact kind a pack lists in `produces` is read here:
 *
 * - `imports` — the pack resolver's `FileReferences` for the file, unchanged.
 *   Resolution needs the whole project, so the caller passes the resolver it
 *   prepared over every file.
 * - `symbols` — declarations, by the pack's {@link PackSymbolRules}, which
 *   the caller passes in.
 * - `calls` — the `calls` query, grouped by `groupCalls`.
 *
 * @module lang-runtime/pack-facts
 */

import type { FactKind, FileFacts, SourceSpan, SymbolFact, SymbolKind } from "@n-dx/lang-kit";
import { groupCalls, innermost } from "./pack-calls.js";
import type { Capture, LanguagePack, PackSourceFile, PreparedResolver } from "./pack.js";

/** How one declaration capture becomes a symbol. */
export interface SymbolRule {
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

/** A rule for a type declaration whose name is captured as `type.name`. */
export const typeRule = (query: string, declaration: string, kind: SymbolKind): SymbolRule => ({
  query,
  declaration,
  name: "type.name",
  kind,
});

/** How a pack's captures become symbols, written against its query files. */
export interface PackSymbolRules {
  readonly rules: readonly SymbolRule[];
  /**
   * A capture that bounds a type without declaring a symbol: a member inside
   * one has no named container, rather than the named type around it.
   */
  readonly anonymousBody?: { readonly query: string; readonly capture: string };
  /**
   * A pass over the file's symbols once the rules have read them (in document
   * order, containers filled), for what a rule cannot say: Python's decorators
   * and `__all__`. Its result is sorted by span start again.
   */
  readonly refine?: (symbols: readonly SymbolFact[], file: PackSourceFile) => SymbolFact[];
}

/** Kinds whose symbols contain members: a member without an explicit container belongs to the nearest one. */
const TYPE_KINDS: ReadonlySet<SymbolKind> = new Set(["class", "interface", "enum", "record", "annotation", "struct"]);

const span = (capture: Capture): SourceSpan => ({ start: capture.start, end: capture.end });

const before = (a: SourceSpan["start"], b: SourceSpan["start"]): number => a.line - b.line || a.column - b.column;

const within = (outer: SourceSpan, inner: SourceSpan): boolean =>
  before(outer.start, inner.start) <= 0 && before(inner.end, outer.end) <= 0;

/** The fields of `FileFacts` other than `path`. */
export type FileFactFields = Omit<FileFacts, "path">;

/**
 * Reads fact kinds that need every file of the project at once rather than
 * one file's captures (Terraform's resources: module calls cross directories).
 * Called once per analysis with every parsed file and the kinds wanted; what
 * it returns for a path is merged into that file's facts. A path it omits gets
 * nothing from it.
 */
export type ProjectFactsReader = (
  files: readonly PackSourceFile[],
  kinds: readonly FactKind[],
) => ReadonlyMap<string, FileFactFields>;

/** Kinds {@link readPackFacts} reads from one file; any other produced kind needs a {@link ProjectFactsReader}. */
const PER_FILE_KINDS: ReadonlySet<FactKind> = new Set(["imports", "symbols", "calls"]);

const IMPORTS_GAP = 'has a resolver but does not produce "imports"';
const SYMBOLS_GAP = 'produces "symbols" but has no symbol rules';
const projectGap = (kind: FactKind): string => `produces "${kind}" but has no project facts reader`;
const frameworkGap = (id: string, kind: FactKind): string => `framework "${id}" produces "${kind}", which the pack does not list`;

/** The kinds a pack produces that neither a per-file read nor a framework covers: its {@link ProjectFactsReader}'s. */
export function projectKinds(pack: LanguagePack): FactKind[] {
  const covered = new Set<FactKind>([...PER_FILE_KINDS, ...(pack.frameworks ?? []).flatMap((f) => f.produces)]);
  return pack.produces.filter((kind) => !covered.has(kind));
}

/**
 * Where a pack's `produces` disagrees with what can be read for it: a resolver
 * whose imports would never be read, symbols with no rules (`symbolRules`
 * undefined), a kind neither a per-file read nor a framework covers with no
 * `projectFacts`, or a framework kind missing from the pack's `produces`.
 * Empty for a consistent pack.
 */
export function factGaps(
  pack: LanguagePack,
  symbolRules: PackSymbolRules | undefined,
  projectFacts?: ProjectFactsReader,
): string[] {
  const frameworks = pack.frameworks ?? [];
  return [
    ...(pack.resolver !== undefined && !pack.produces.includes("imports") ? [IMPORTS_GAP] : []),
    ...(pack.produces.includes("symbols") && symbolRules === undefined ? [SYMBOLS_GAP] : []),
    ...(projectFacts === undefined ? projectKinds(pack).map(projectGap) : []),
    ...frameworks.flatMap((f) => f.produces.filter((kind) => !pack.produces.includes(kind)).map((kind) => frameworkGap(f.id, kind))),
  ];
}

/**
 * `extra`'s facts laid over `base`: a list both fill is concatenated, `base`
 * first; anything else in `extra` replaces `base`'s.
 */
export function mergeFileFacts<T extends FileFactFields>(base: T, extra: FileFactFields | undefined): T {
  if (extra === undefined) return base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const prior = merged[key];
    merged[key] = Array.isArray(prior) && Array.isArray(value) ? [...prior, ...value] : value;
  }
  return merged as T;
}

/**
 * The symbols a file declares, in document order of their declarations.
 * Throws for a pack without symbol rules: an empty list would read as
 * "declares nothing".
 */
export function readSymbols(pack: LanguagePack, file: PackSourceFile, symbolRules: PackSymbolRules | undefined): SymbolFact[] {
  if (symbolRules === undefined) throw new Error(`${pack.id}: ${SYMBOLS_GAP}`);
  const { rules, anonymousBody: anonymous } = symbolRules;
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
  const bodies = anonymous ? (file.captures[anonymous.query] ?? []).filter((c) => c.name === anonymous.capture) : [];
  const contained = symbols.map((symbol) => {
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
  return symbolRules.refine ? symbolRules.refine(contained, file).sort((a, b) => before(a.span.start, b.span.start)) : contained;
}

export interface ReadFactsOptions {
  /** Kinds to read; defaults to everything the pack produces. A kind the pack does not produce stays absent. */
  readonly kinds?: readonly FactKind[];
  /** The pack's resolver, prepared over the whole project. `imports` is read only when it is given. */
  readonly resolver?: PreparedResolver;
  /** The pack's symbol rules. Reading `symbols` without them throws; see {@link readSymbols}. */
  readonly symbolRules?: PackSymbolRules;
}

/** Read one parsed file's captures into lang-kit's per-file facts. */
export function readPackFacts(pack: LanguagePack, file: PackSourceFile, options: ReadFactsOptions = {}): FileFacts {
  const wanted = new Set(options.kinds ?? pack.produces);
  const reads = (kind: FactKind): boolean => wanted.has(kind) && pack.produces.includes(kind);
  return {
    path: file.path,
    ...(reads("imports") && options.resolver ? { imports: options.resolver.resolve(file.path) } : {}),
    ...(reads("symbols") ? { symbols: readSymbols(pack, file, options.symbolRules) } : {}),
    ...(reads("calls") ? { calls: groupCalls(file.captures.calls ?? []) } : {}),
  };
}
