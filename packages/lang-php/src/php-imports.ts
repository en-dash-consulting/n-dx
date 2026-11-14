/**
 * PHP imports as written, read from the `imports` and `guards` captures
 * (`queries/php/`): each include with its path expression as written, and
 * each `use` import with its qualified name, form and alias.
 *
 * `php-resolver.ts` resolves the `use` imports; includes are reported as
 * written and not resolved.
 *
 * @module lang-php/php-imports
 */

import type { ImportForm, WrittenImport } from "@n-dx/lang-kit";
import { contains, innermost, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";

const INCLUDE_FORMS: Readonly<Record<string, ImportForm>> = {
  "import.include": "include",
  "import.include_once": "include_once",
  "import.require": "require",
  "import.require_once": "require_once",
};

const USE_FORMS: Readonly<Record<string, ImportForm>> = { function: "use function", const: "use const" };

/** A name as written, without the whitespace PHP 7 allowed around `\`. */
const qualified = (capture: Capture): string => capture.text.replace(/\s+/g, "");

/** An include's or use's place in document order. */
const before = (a: WrittenImport, b: WrittenImport): number =>
  a.position.line - b.position.line || a.position.column - b.position.column;

/** The file's includes and `use` imports in document order; an include in a conditional region carries `conditional`. */
export function readWrittenImports(file: PackSourceFile): WrittenImport[] {
  const captures = file.captures.imports ?? [];
  const named = (name: string): Capture[] => captures.filter((c) => c.name === name);
  const guards = (file.captures.guards ?? []).filter((c) => c.name === "guard.conditional");
  const guarded = (statement: Capture): boolean => guards.some((g) => contains(g, statement));

  const written: WrittenImport[] = [];

  const includes = captures.filter((c) => c.name in INCLUDE_FORMS);
  const ownedBy = (name: string): Map<Capture, Capture> => {
    const owned = new Map<Capture, Capture>();
    for (const part of named(name)) {
      const owner = innermost(includes, part);
      if (owner && !owned.has(owner)) owned.set(owner, part);
    }
    return owned;
  };
  const paths = ownedBy("import.path");
  const innerPaths = ownedBy("import.inner_path");
  for (const statement of includes) {
    const path = paths.get(statement);
    if (path === undefined) continue;
    // `require_once("x.php")`: the parentheses are the statement's, not the path's.
    const spec = path.nodeType === "parenthesized_expression" ? (innerPaths.get(statement) ?? path) : path;
    written.push({
      specifier: spec.text,
      names: [],
      position: spec.start,
      form: INCLUDE_FORMS[statement.name]!,
      ...(guarded(statement) ? { guard: "conditional" as const } : {}),
    });
  }

  const declarations = named("use.declaration");
  const clauses = named("use.clause");
  const inClause = (part: Capture): Capture | undefined => innermost(clauses, part);
  const types = named("use.type");
  for (const declaration of declarations) {
    const prefix = named("use.prefix").find((p) => innermost(declarations, p) === declaration);
    const declarationType = types.find((t) => contains(declaration, t) && inClause(t) === undefined);
    for (const clause of clauses) {
      if (innermost(declarations, clause) !== declaration) continue;
      const name = named("use.name").find((n) => inClause(n) === clause);
      if (name === undefined) continue;
      const alias = named("use.alias").find((a) => inClause(a) === clause);
      const type = types.find((t) => inClause(t) === clause) ?? declarationType;
      const form = type === undefined ? "use" : USE_FORMS[type.text];
      if (form === undefined) continue;
      written.push({
        specifier: prefix === undefined ? qualified(name) : `${qualified(prefix)}\\${qualified(name)}`,
        names: [],
        position: name.start,
        form,
        ...(alias === undefined ? {} : { alias: alias.text }),
      });
    }
  }

  return written.sort(before);
}
