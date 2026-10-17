/**
 * Python symbols: the rules that read classes, functions and module-level
 * names from `queries/python/definitions.scm` and `variables.scm`, and the
 * pass that adds what a rule cannot say: methods, decorators and `__all__`.
 *
 * @module lang-python/python-symbols
 */

import type { SourceSpan, SymbolFact } from "@n-dx/lang-kit";
import { atOrBefore, contains, innermost, type Capture, type PackSourceFile, type PackSymbolRules } from "@n-dx/lang-runtime";

const spanOf = (capture: Capture): SourceSpan => ({ start: capture.start, end: capture.end });

const samePosition = (a: SourceSpan["start"], b: SourceSpan["start"]): boolean => a.line === b.line && a.column === b.column;

const sameSpan = (a: SourceSpan, b: SourceSpan): boolean => samePosition(a.start, b.start) && samePosition(a.end, b.end);

const within = (outer: SourceSpan, inner: SourceSpan): boolean => atOrBefore(outer.start, inner.start) && atOrBefore(inner.end, outer.end);

/** A plain string literal's text (`"a"`, `'a'`, `u"a"`, `r'a'`, triple-quoted); undefined for anything else. */
const PLAIN_STRING = /^[rRuU]?("""|'''|"|')([^\\]*)\1$/s;

export function stringLiteralValue(text: string): string | undefined {
  const match = PLAIN_STRING.exec(text);
  return match === null || match[2]!.includes(match[1]!) ? undefined : match[2];
}

/**
 * `__all__`'s names when the value of the assignment `symbol` spans is a list
 * or tuple of plain string literals; undefined otherwise.
 */
function readExports(symbol: SymbolFact, captures: readonly Capture[]): string[] | undefined {
  const value = captures.find((c) => c.name === "all.value" && within(symbol.span, spanOf(c)));
  if (value === undefined) return undefined;
  const names: string[] = [];
  for (const item of captures) {
    if (item.name !== "all.item" || !contains(value, item) || item.nodeType === "comment") continue;
    const name = item.nodeType === "string" ? stringLiteralValue(item.text) : undefined;
    if (name === undefined) return undefined;
    names.push(name);
  }
  return names;
}

/** The decorators on the definition spanning `span`, with the decorated span; undefined when it has none. */
function readDecorators(span: SourceSpan, captures: readonly Capture[]): { span: SourceSpan; decorators: string[] } | undefined {
  const definition = captures.find((c) => c.name === "decorated.definition" && sameSpan(spanOf(c), span));
  if (definition === undefined) return undefined;
  const declaration = innermost(
    captures.filter((c) => c.name === "decorated.declaration"),
    definition,
  );
  if (declaration === undefined) return undefined;
  const decorators = captures
    .filter((c) => c.name === "decorated.decorator" && contains(declaration, c) && atOrBefore(c.end, definition.start))
    .map((c) => c.text);
  return { span: spanOf(declaration), decorators };
}

/** Methods, decorators and `__all__`, over the symbols the rules read. */
function refinePythonSymbols(symbols: readonly SymbolFact[], file: PackSourceFile): SymbolFact[] {
  const definitions = file.captures.definitions ?? [];
  const variables = file.captures.variables ?? [];
  const scopes = symbols.filter((s) => s.kind === "class" || s.kind === "function");
  return symbols.map((symbol) => {
    if (symbol.kind === "variable") {
      if (symbol.name !== "__all__") return symbol;
      const exports = readExports(symbol, variables);
      return exports === undefined ? symbol : { ...symbol, exports };
    }
    // A function whose nearest enclosing class or function is a class is a method.
    let owner: SymbolFact | undefined;
    for (const other of scopes) {
      if (other === symbol || !within(other.span, symbol.span)) continue;
      if (owner === undefined || within(owner.span, other.span)) owner = other;
    }
    const kind = symbol.kind === "function" && owner?.kind === "class" ? "method" : symbol.kind;
    const decorated = readDecorators(symbol.span, definitions);
    return {
      ...symbol,
      kind,
      ...(decorated === undefined ? {} : { span: decorated.span, decorators: decorated.decorators }),
    };
  });
}

/** Symbol rules, written against `queries/python/*.scm`. */
export const PYTHON_SYMBOL_RULES: PackSymbolRules = {
  rules: [
    { query: "definitions", declaration: "class.declaration", name: "class.name", kind: "class" },
    { query: "definitions", declaration: "function.declaration", name: "function.name", kind: "function" },
    { query: "variables", declaration: "variable.declaration", name: "variable.name", kind: "variable" },
  ],
  refine: refinePythonSymbols,
};
