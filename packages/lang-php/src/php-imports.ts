/**
 * PHP imports as written, read from the `imports` and `guards` captures
 * (`queries/php/`): each include with its path expression as written, and
 * each `use` import with its qualified name, form and alias.
 *
 * `php-resolver.ts` resolves the `use` imports, and `php-includes.ts` the
 * includes whose path is computable.
 *
 * @module lang-php/php-imports
 */

import type { ImportForm, WrittenImport } from "@n-dx/lang-kit";
import { innermostEach, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";

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
  const guards = (file.captures.guards ?? []).filter((c) => c.name === "guard.conditional" || c.name === "guard.function");

  const written: WrittenImport[] = [];

  const includes = captures.filter((c) => c.name in INCLUDE_FORMS);
  const guardOf = innermostEach(guards, includes);
  const paths = firstOwned(includes, named("import.path"));
  const innerPaths = firstOwned(includes, named("import.inner_path"));
  includes.forEach((statement, i) => {
    const path = paths.get(statement);
    if (path === undefined) return;
    // `require_once("x.php")`: the parentheses are the statement's, not the path's.
    const spec = path.nodeType === "parenthesized_expression" ? (innerPaths.get(statement) ?? path) : path;
    written.push({
      specifier: spec.text,
      names: [],
      position: spec.start,
      form: INCLUDE_FORMS[statement.name]!,
      ...(guardOf[i] === undefined ? {} : { guard: "conditional" as const }),
    });
  });

  // Each part is paired with its owner in one sweep (`innermostEach`): a file
  // with thousands of `use` lines costs n log n, where a scan per declaration
  // and clause was cubic (#1082 P5).
  const declarations = named("use.declaration");
  const clauses = named("use.clause");
  const types = named("use.type");
  const prefixes = firstOwned(declarations, named("use.prefix"));
  const clauseOfType = innermostEach(clauses, types);
  const clauseTypes = firstOf(clauseOfType, types);
  // `use function A\{b, c}`: a type outside every clause is the declaration's.
  const declarationTypes = firstOwned(
    declarations,
    types.filter((_, i) => clauseOfType[i] === undefined),
  );
  const names = firstOwned(clauses, named("use.name"));
  const aliases = firstOwned(clauses, named("use.alias"));
  const declarationOf = innermostEach(declarations, clauses);
  clauses.forEach((clause, i) => {
    const declaration = declarationOf[i];
    const name = names.get(clause);
    if (declaration === undefined || name === undefined) return;
    const prefix = prefixes.get(declaration);
    const alias = aliases.get(clause);
    const type = clauseTypes.get(clause) ?? declarationTypes.get(declaration);
    const form = type === undefined ? "use" : USE_FORMS[type.text];
    if (form === undefined) return;
    written.push({
      specifier: prefix === undefined ? qualified(name) : `${qualified(prefix)}\\${qualified(name)}`,
      names: [],
      position: name.start,
      form,
      ...(alias === undefined ? {} : { alias: alias.text }),
    });
  });

  return written.sort(before);
}

/** For each owner, the first of `parts` (in capture order) whose innermost owner it is. */
const firstOwned = (owners: readonly Capture[], parts: readonly Capture[]): Map<Capture, Capture> =>
  firstOf(innermostEach(owners, parts), parts);

/** For each owner in `ownerOf` (index i owns `parts[i]`), the first part it owns. */
function firstOf(ownerOf: readonly (Capture | undefined)[], parts: readonly Capture[]): Map<Capture, Capture> {
  const owned = new Map<Capture, Capture>();
  ownerOf.forEach((owner, i) => {
    if (owner !== undefined && !owned.has(owner)) owned.set(owner, parts[i]!);
  });
  return owned;
}
