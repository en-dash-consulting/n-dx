/**
 * PHP declarations: each file's namespaces and the classes, interfaces,
 * traits and enums it declares, with the fully qualified name PHP gives
 * each, read from the `definitions` captures the symbol rules already use
 * (`queries/php/definitions.scm`), so this framework adds no query.
 *
 * - A type's namespace is the braced `namespace A { … }` around it, or the
 *   last `namespace A;` before it; outside both it is global and its
 *   qualified name is its name. A global `namespace { … }` names nothing.
 * - A type declared inside a conditional block, function or method is still
 *   declared (the query matches at any depth); an anonymous class is not
 *   (it is no `class_declaration`).
 *
 * A file that opens no namespace and declares no type gets no fact.
 *
 * @module lang-php/php-declarations
 */

import type { DeclarationsFact, DeclaredType, FactKind, FileFacts, SymbolKind } from "@n-dx/lang-kit";
import { atOrBefore, type Capture, type FrameworkFacts, type FrameworkPack, type PackSourceFile, type RuleProvenance } from "@n-dx/lang-runtime";

/** The `definitions` captures naming a type, by the kind they declare. */
const TYPE_NAMES: ReadonlyMap<string, SymbolKind> = new Map([
  ["class.name", "class"],
  ["interface.name", "interface"],
  ["trait.name", "trait"],
  ["enum.name", "enum"],
]);

interface Namespace {
  readonly name: string;
  readonly declaration: Capture;
  readonly braced: boolean;
}

const contains = (outer: Capture, inner: Capture): boolean => atOrBefore(outer.start, inner.start) && atOrBefore(inner.end, outer.end);

/** Each named namespace declaration with its name and form, in document order. */
function namespacesOf(definitions: readonly Capture[]): Namespace[] {
  const names = definitions.filter((c) => c.name === "namespace.name");
  const bodies = definitions.filter((c) => c.name === "namespace.body");
  return definitions.flatMap((declaration) => {
    if (declaration.name !== "namespace.declaration") return [];
    const name = names.find((n) => contains(declaration, n));
    if (name === undefined) return [];
    return [{ name: name.text, declaration, braced: bodies.some((b) => contains(declaration, b)) }];
  });
}

/** The namespace a name at `at` is declared in: the braced one around it, else the last unbraced one before it. */
function namespaceAt(at: Capture, namespaces: readonly Namespace[]): string | undefined {
  const braced = namespaces.find((ns) => ns.braced && contains(ns.declaration, at));
  if (braced !== undefined) return braced.name;
  return namespaces.filter((ns) => !ns.braced && atOrBefore(ns.declaration.end, at.start)).at(-1)?.name;
}

/** One file's declarations; undefined when it opens no namespace and declares no type. */
export function readPhpDeclarations(file: PackSourceFile): DeclarationsFact | undefined {
  const definitions = file.captures.definitions ?? [];
  const namespaces = namespacesOf(definitions);
  const types: DeclaredType[] = definitions.flatMap((capture) => {
    const kind = TYPE_NAMES.get(capture.name);
    if (kind === undefined) return [];
    const namespace = namespaceAt(capture, namespaces);
    return [{ name: capture.text, qualifiedName: namespace === undefined ? capture.text : `${namespace}\\${capture.text}`, kind, position: capture.start }];
  });
  if (namespaces.length === 0 && types.length === 0) return undefined;
  return { namespaces: [...new Set(namespaces.map((ns) => ns.name))], types };
}

const GRAMMAR = "tree-sitter-php@0.25.1";

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  // A name's namespace: the braced block around it, or the last `namespace X;` before it.
  namespaces: {
    verifiedAgainst: [GRAMMAR, "PHP manual"],
    verifiedOn: "2026-11-25",
    source: "https://www.php.net/manual/en/language.namespaces.definitionmultiple.php",
  },
  // A class declared in a conditional block is declared when the block runs.
  "conditional-declarations": {
    verifiedAgainst: [GRAMMAR, "PHP manual"],
    verifiedOn: "2026-11-25",
    source: "https://www.php.net/manual/en/language.oop5.basic.php",
  },
};

export const phpDeclarations: FrameworkPack = {
  id: "php-declarations",
  produces: ["declarations"],
  queries: [],
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[]): FrameworkFacts {
    const facts = new Map<string, Omit<FileFacts, "path">>();
    if (!kinds.includes("declarations")) return { facts, notices: [] };
    for (const file of files) {
      const declarations = readPhpDeclarations(file);
      if (declarations !== undefined) facts.set(file.path, { declarations });
    }
    return { facts, notices: [] };
  },
};
