/**
 * PHP symbols: the rules that read declarations from
 * `queries/php/definitions.scm`, and the pass that adds what a rule cannot
 * say: which methods are constructors, and that functions and `define()`
 * constants are global wherever they are written.
 *
 * @module lang-php/php-symbols
 */

import type { SourceSpan, SymbolFact } from "@n-dx/lang-kit";
import { atOrBefore, type Capture, type PackSourceFile, type PackSymbolRules } from "@n-dx/lang-runtime";

const spanOf = (capture: Capture): SourceSpan => ({ start: capture.start, end: capture.end });

const within = (outer: SourceSpan, inner: SourceSpan): boolean => atOrBefore(outer.start, inner.start) && atOrBefore(inner.end, outer.end);

const samePosition = (a: SourceSpan["start"], b: SourceSpan["start"]): boolean => a.line === b.line && a.column === b.column;

/** A quoted string holding only a constant name (`'APP_ROOT'`, `"Acme\\VERSION"`); undefined for anything else. */
const DEFINE_NAME = /^(['"])([A-Za-z_\x80-￿][\w\x80-￿]*(?:\\{1,2}[A-Za-z_\x80-￿][\w\x80-￿]*)*)\1$/;

/** The constant `define()` declares, when its name is a plain literal. */
export function defineName(text: string): string | undefined {
  const match = DEFINE_NAME.exec(text);
  return match === null ? undefined : match[2]!.replace(/\\\\/g, "\\");
}

/**
 * True when the class spanning `span` is in a namespace: inside a braced
 * `namespace A { … }`, or after an unbraced `namespace A;`.
 */
function namespaced(span: SourceSpan, definitions: readonly Capture[]): boolean {
  const bodies = definitions.filter((c) => c.name === "namespace.body");
  return definitions.some((c) => {
    if (c.name !== "namespace.declaration") return false;
    const braced = bodies.some((b) => within(spanOf(c), spanOf(b)));
    return braced ? within(spanOf(c), span) : atOrBefore(c.end, span.start);
  });
}

/**
 * Constructors, and global functions and `define()` constants.
 *
 * - A method named `__construct` (in any letter case: PHP method names are
 *   case-insensitive) is a constructor.
 * - So is a method named as its class, in a class outside any namespace that
 *   declares no `__construct`: the PHP 4 constructor legacy code still uses.
 * - A function, or a constant from `define()`, declared inside a class's
 *   method is still global: it takes no container.
 */
function refinePhpSymbols(symbols: readonly SymbolFact[], file: PackSourceFile): SymbolFact[] {
  const definitions = file.captures.definitions ?? [];
  const defines = definitions.filter((c) => c.name === "define.name");
  const classes = symbols.filter((s) => s.kind === "class");
  const methodsOf = (owner: SymbolFact): SymbolFact[] =>
    symbols.filter((s) => s.kind === "method" && s.container === owner.name && within(owner.span, s.span));

  return symbols.map((symbol) => {
    if (symbol.kind === "function" || (symbol.kind === "constant" && defines.some((d) => samePosition(d.start, symbol.position)))) {
      if (symbol.container === undefined) return symbol;
      const { container: _container, ...global } = symbol;
      return global;
    }
    if (symbol.kind !== "method") return symbol;
    const name = symbol.name.toLowerCase();
    if (name === "__construct") return { ...symbol, kind: "constructor" };
    const owner = classes.find((c) => c.name === symbol.container && within(c.span, symbol.span));
    if (
      owner !== undefined &&
      owner.name.toLowerCase() === name &&
      !namespaced(owner.span, definitions) &&
      !methodsOf(owner).some((m) => m.name.toLowerCase() === "__construct")
    ) {
      return { ...symbol, kind: "constructor" };
    }
    return symbol;
  });
}

/** Symbol rules, written against `queries/php/definitions.scm`. */
export const PHP_SYMBOL_RULES: PackSymbolRules = {
  rules: [
    { query: "definitions", declaration: "class.declaration", name: "class.name", kind: "class" },
    { query: "definitions", declaration: "interface.declaration", name: "interface.name", kind: "interface" },
    { query: "definitions", declaration: "trait.declaration", name: "trait.name", kind: "trait" },
    { query: "definitions", declaration: "enum.declaration", name: "enum.name", kind: "enum" },
    { query: "definitions", declaration: "function.declaration", name: "function.name", kind: "function" },
    { query: "definitions", declaration: "method.declaration", name: "method.name", kind: "method" },
    { query: "definitions", declaration: "namespace.declaration", name: "namespace.name", kind: "namespace" },
    { query: "definitions", declaration: "constant.declaration", name: "constant.name", kind: "constant" },
    {
      query: "definitions",
      declaration: "define.declaration",
      name: "define.name",
      kind: "constant",
      read: (text) => {
        const name = defineName(text);
        return name === undefined ? undefined : { name };
      },
    },
  ],
  anonymousBody: { query: "definitions", capture: "class.anonymous_body" },
  refine: refinePhpSymbols,
};
