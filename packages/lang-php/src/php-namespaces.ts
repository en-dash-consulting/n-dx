/**
 * PHP namespaces over a file's captures: its namespace regions, its `use`
 * aliases per region, and how a function call resolves.
 *
 * Function calls resolve as PHP resolves them
 * (https://www.php.net/manual/en/language.namespaces.rules.php):
 *
 * - `\f` is the global function `f`; `namespace\f` the current namespace's.
 * - A qualified `A\f` is a namespace's function, never a global one.
 * - An unqualified `f` is the function a `use function` of the region
 *   imports as `f`; else the current namespace's `f` when one is declared,
 *   then the global `f`.
 *
 * The legacy-construct and dynamic-code scanners take a call's
 * {@link callCandidates} as each file is parsed, and ask {@link builtinReached}
 * which built-in it reaches once every file's declarations are known: a call
 * that resolves to a function the repository declares (a namespaced helper,
 * a global polyfill) reaches none.
 *
 * @module lang-php/php-namespaces
 */

import type { SourcePosition, WrittenImport } from "@n-dx/lang-kit";
import { contains, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";
import { readWrittenImports } from "./php-imports.js";

/** A name as written, without the whitespace PHP 7 allowed around `\`. */
export const tidy = (text: string): string => text.replace(/\s+/g, "");

const before = (a: SourcePosition, b: SourcePosition): boolean => a.line < b.line || (a.line === b.line && a.column <= b.column);

/** A namespace region: a braced block, or an unbraced statement up to the next. */
export interface Region {
  readonly name: string;
  readonly start: SourcePosition;
  /** Set for a braced namespace. */
  readonly end?: SourcePosition;
}

/** The file's namespace regions, in document order. */
export function regionsOf(file: PackSourceFile): Region[] {
  const defs = file.captures.definitions ?? [];
  const names = defs.filter((c) => c.name === "namespace.name");
  const bodies = defs.filter((c) => c.name === "namespace.body");
  return defs
    .filter((c) => c.name === "namespace.declaration")
    .map((declaration): Region | undefined => {
      const name = names.find((n) => contains(declaration, n));
      if (name === undefined) return undefined;
      const braced = bodies.some((b) => contains(declaration, b));
      return { name: tidy(name.text).replace(/^\\/, ""), start: declaration.start, ...(braced ? { end: declaration.end } : {}) };
    })
    .filter((r): r is Region => r !== undefined)
    .sort((a, b) => (before(a.start, b.start) ? -1 : 1));
}

/** The region holding `at`; undefined in the global namespace. */
export function regionAt(regions: readonly Region[], at: SourcePosition): Region | undefined {
  let found: Region | undefined;
  for (const region of regions) {
    if (!before(region.start, at)) break;
    found = region;
  }
  if (found?.end !== undefined && !before(at, found.end)) return undefined;
  return found;
}

export const inNamespace = (region: Region | undefined, name: string): string => (region === undefined ? name : `${region.name}\\${name}`);

/** A file's imports of one `form` per region (undefined is global): local name, lowercase, to the qualified name. */
export function useAliases(regions: readonly Region[], written: readonly WrittenImport[], form: "use" | "use function"): Map<Region | undefined, Map<string, string>> {
  const byRegion = new Map<Region | undefined, Map<string, string>>();
  for (const w of written) {
    if (w.form !== form) continue;
    const region = regionAt(regions, w.position);
    let aliases = byRegion.get(region);
    if (!aliases) byRegion.set(region, (aliases = new Map()));
    const qualified = w.specifier.replace(/^\\/, "");
    const local = w.alias ?? qualified.slice(qualified.lastIndexOf("\\") + 1);
    aliases.set(local.toLowerCase(), qualified);
  }
  return byRegion;
}

/** Every function any of `files` declares, fully qualified and lowercase (PHP reads function names in any case). */
export function declaredFunctions(files: readonly PackSourceFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const functions = (file.captures.definitions ?? []).filter((c) => c.name === "function.name");
    if (functions.length === 0) continue;
    const regions = regionsOf(file);
    for (const c of functions) names.add(inNamespace(regionAt(regions, c.start), tidy(c.text)).toLowerCase());
  }
  return names;
}

/** A file has a `use function` only when one of its `use` statements or clauses carries the keyword. */
const importsFunctions = (file: PackSourceFile): boolean =>
  (file.captures.imports ?? []).some((c) => c.name === "use.type" && c.text.toLowerCase() === "function");

/**
 * For each function call's callee in `file`, the functions it may name, in
 * the order PHP tries them (a namespaced name, then the global fallback);
 * undefined for a qualified name, which never reaches a built-in. Reads one
 * file only, so it can run before every file's declarations are known.
 */
export function callCandidates(file: PackSourceFile): (callee: Capture) => string[] | undefined {
  const regions = regionsOf(file);
  const aliases = importsFunctions(file) ? useAliases(regions, readWrittenImports(file), "use function") : new Map<Region | undefined, Map<string, string>>();
  return (callee) => {
    const name = tidy(callee.text);
    const region = regionAt(regions, callee.start);
    if (name.startsWith("\\")) return [name.slice(1)];
    if (/^namespace\\/i.test(name)) return [inNamespace(region, name.slice("namespace\\".length))];
    if (name.includes("\\")) return undefined;
    const imported = aliases.get(region)?.get(name.toLowerCase());
    return imported !== undefined ? [imported] : region === undefined ? [name] : [inNamespace(region, name), name];
  };
}

/**
 * The built-in {@link callCandidates} reach: the global function's name (as
 * written, or as its `use function` names it), unless one of them is in
 * `declared` ({@link declaredFunctions}) or the last is namespaced.
 */
export function builtinReached(candidates: readonly string[] | undefined, declared: ReadonlySet<string>): string | undefined {
  if (candidates === undefined || candidates.some((c) => declared.has(c.toLowerCase()))) return undefined;
  const reached = candidates[candidates.length - 1]!;
  return reached.includes("\\") ? undefined : reached;
}
