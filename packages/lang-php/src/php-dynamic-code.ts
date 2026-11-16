/**
 * Dynamic code over the PHP pack: per file, each place code runs a string as
 * code or chooses what to run from a value, as lang-kit's `DynamicCodeFact`.
 * They are what reading the files alone cannot explain (a route kept in a
 * database row, PHP stored in content), so a migration must account for
 * each. Locations and the expression as written only, never a value.
 *
 * A framework pack (lang-runtime's `FrameworkPack`): its query
 * (`queries/php-dynamic/dynamic.scm`) runs in the PHP parse only when dynamic
 * code is wanted.
 *
 * - `exec`, code run from a string: `eval(…)`; `assert(…)` whose first
 *   argument is a string; `preg_replace` whose pattern is a literal with the
 *   `e` modifier; `create_function(…)`. `literal` when the code is written as
 *   literals alone (`eval('return 1;')`): eval's and assert's first argument,
 *   preg_replace's replacement, create_function's both.
 * - `dispatch`, what runs chosen by a value: `call_user_func`,
 *   `call_user_func_array`, `forward_static_call(_array)` with a callable that
 *   is not static; callback built-ins ({@link CALLBACK_ARGUMENT}) the same way
 *   on their callback argument; a callee that is not a name (`$f()`,
 *   `$handlers[$k]()`); `new` of a class that is not a name (`new $class`);
 *   a method named by a value (`$o->$m()`, `$o->{$expr}()`, `$c::$m()`,
 *   `$c::{$expr}()`). A static callable is a string without interpolation, a
 *   closure, a name or `X::class`, a first-class callable `f(...)`, or an
 *   array of those and `$this` (`[$this, 'save']`); `[$this, $name]` is not.
 * - `include`, an include whose path is not computable (`php-includes.ts`),
 *   `host-include` when it reads the request's host name, else
 *   `dynamic-include`. The resolver's `[php-dynamic-include]` and
 *   `[php-host-include]` notices already name them, so they are counted here,
 *   never noticed again.
 *
 * A named rule is PHP's function only when called by its global name (`eval`,
 * `\eval`; never `\App\eval`) and the repository declares no function of that
 * name (a polyfill). The scope is the innermost function (`name`), method
 * (`Class::name`, `class@anonymous::name`) or closure (`{closure:<outer>}`,
 * `{closure}` at the top level) holding the site; absent at a file's top level.
 *
 * Notices: `[php-dynamic-exec]` and `[php-dynamic-dispatch]`, each with its
 * sites' locations, as `php-include-notices.ts` lists dynamic includes.
 *
 * @module lang-php/php-dynamic-code
 */

import { join } from "node:path";
import type { DynamicCodeFact, FactKind, FileFacts, SourcePosition } from "@n-dx/lang-kit";
import { innermostEach, type Capture, type FrameworkFacts, type FrameworkPack, type PackSourceFile, type RuleProvenance } from "@n-dx/lang-runtime";
import { PHP_PACKAGE } from "./package-paths.js";
import { readWrittenImports } from "./php-imports.js";
import { hostReader, noticeLocations } from "./php-include-notices.js";
import { isDynamicIncludePath, isInclude, repositoryConstants, type ConstantLookup } from "./php-includes.js";

/** The notice code of sites that run a string as code. */
export const PHP_DYNAMIC_EXEC = "php-dynamic-exec";
/** The notice code of sites that choose what to run from a value. */
export const PHP_DYNAMIC_DISPATCH = "php-dynamic-dispatch";

const QUERY = "dynamic";
const PREFIX = "dynamic.";

/** Functions that run a string as code, by lower-cased name. */
const EXEC_FUNCTIONS = new Set(["eval", "assert", "preg_replace", "create_function"]);

/** Functions that call their first argument. */
const CALLERS = new Set(["call_user_func", "call_user_func_array", "forward_static_call", "forward_static_call_array"]);

/** Built-ins that call a callback they are given, by lower-cased name: the callback's argument index. */
export const CALLBACK_ARGUMENT: ReadonlyMap<string, number> = new Map([
  ["array_map", 0],
  ["array_filter", 1],
  ["array_reduce", 1],
  ["array_walk", 1],
  ["array_walk_recursive", 1],
  ["usort", 1],
  ["uasort", 1],
  ["uksort", 1],
  ["preg_replace_callback", 1],
  ["iterator_apply", 1],
  ["register_shutdown_function", 0],
  ["set_error_handler", 0],
  ["set_exception_handler", 0],
]);

const NAME_TYPES = new Set(["name", "qualified_name", "relative_name"]);
const STRING_TYPES = new Set(["string", "encapsed_string", "heredoc", "nowdoc"]);
const SCALAR_TYPES = new Set(["integer", "float", "boolean", "null"]);
/** Callables whose target is fixed where they are written. */
const STATIC_CALLABLE_TYPES = new Set([
  ...NAME_TYPES,
  "anonymous_function",
  "arrow_function",
  "class_constant_access_expression",
  "object_creation_expression",
]);
const CLOSURE_IN_PARENS = /^\(\s*(static\s+)?(function|fn)\b/;

/** A string or heredoc without interpolation, a nowdoc, or a scalar. */
function isLiteral(node: Capture | undefined): boolean {
  if (node === undefined) return false;
  if (node.nodeType === "string" || node.nodeType === "nowdoc" || SCALAR_TYPES.has(node.nodeType)) return true;
  return (node.nodeType === "encapsed_string" || node.nodeType === "heredoc") && !node.text.includes("$");
}

/** One file's captures, grouped and paired. */
class FileCaptures {
  private readonly by = new Map<string, Capture[]>();
  /** Each argument list's arguments, in order. */
  private readonly argumentsOf = new Map<Capture, Capture[]>();
  /** Each argument's value: its last own child. */
  private readonly valueOf = new Map<Capture, Capture>();
  /** Each array's elements, keyed by its span: the array reaches a rule as another query capture of the same node. */
  private readonly elementsOf = new Map<string, Capture[]>();
  private readonly listEndingAt = new Map<string, Capture>();

  constructor(file: PackSourceFile) {
    for (const capture of file.captures[QUERY] ?? []) {
      const name = capture.name.slice(PREFIX.length);
      let list = this.by.get(name);
      if (list === undefined) this.by.set(name, (list = []));
      list.push(capture);
    }
    const lists = this.get("arguments");
    const args = this.get("argument");
    for (const list of lists) this.listEndingAt.set(key(list.end), list);
    group(this.argumentsOf, innermostEach(lists, args), args);
    const values = this.get("argument-value");
    innermostEach(args, values).forEach((arg, i) => {
      if (arg !== undefined) this.valueOf.set(arg, values[i]!);
    });
    const elements = this.get("element");
    const arrays = new Map<Capture, Capture[]>();
    group(arrays, innermostEach(this.get("array"), elements), elements);
    for (const [array, list] of arrays) this.elementsOf.set(span(array), list);
  }

  get(name: string): Capture[] {
    return this.by.get(name) ?? [];
  }

  /** The values of a call's arguments, in order. */
  argumentValues(call: Capture): (Capture | undefined)[] {
    const list = this.listEndingAt.get(key(call.end));
    return (list === undefined ? [] : (this.argumentsOf.get(list) ?? [])).map((a) => this.valueOf.get(a));
  }

  /** Whether `node` names its target where it is written; see the module comment. */
  isStaticCallable(node: Capture | undefined): boolean {
    if (node === undefined) return false;
    if (STATIC_CALLABLE_TYPES.has(node.nodeType)) return true;
    if (STRING_TYPES.has(node.nodeType)) return isLiteral(node);
    if (node.nodeType === "parenthesized_expression") return CLOSURE_IN_PARENS.test(node.text);
    if (/(call_expression)$/.test(node.nodeType)) return /\(\s*\.\.\.\s*\)$/.test(node.text);
    if (node.nodeType === "array_creation_expression") {
      return (this.elementsOf.get(span(node)) ?? []).every((e) => (e.nodeType === "variable_name" && e.text === "$this") || this.isStaticCallable(e));
    }
    return false;
  }
}

const key = (p: SourcePosition): string => `${p.line}:${p.column}`;
const span = (c: Capture): string => `${key(c.start)}-${key(c.end)}`;

function group(into: Map<Capture, Capture[]>, owners: readonly (Capture | undefined)[], captured: readonly Capture[]): void {
  owners.forEach((owner, i) => {
    if (owner === undefined) return;
    const list = into.get(owner);
    if (list === undefined) into.set(owner, [captured[i]!]);
    else list.push(captured[i]!);
  });
}

/** The modifiers of a regular expression written as a PHP string literal; undefined when it has no delimiters. */
export function patternModifiers(literal: Capture): string | undefined {
  const pattern = (literal.nodeType === "string" ? literal.text.slice(1, -1).replace(/\\([\\'])/g, "$1") : literal.text.slice(1, -1)).trimStart();
  const open = pattern[0];
  if (open === undefined || /[\w\\\s]/.test(open)) return undefined;
  const close = ({ "(": ")", "[": "]", "{": "}", "<": ">" } as Record<string, string>)[open] ?? open;
  const end = pattern.lastIndexOf(close);
  return end <= 0 ? undefined : pattern.slice(end + 1);
}

/** One site before its scope is named. */
interface Site {
  readonly kind: DynamicCodeFact["kind"];
  readonly construct: string;
  readonly expression: string;
  readonly position: SourcePosition;
  readonly literal?: true;
}

/** The exec or dispatch site a call of global function `name` is, if any. */
function namedCallSite(name: string, call: Capture, captures: FileCaptures): Site | undefined {
  const args = captures.argumentValues(call);
  const at = { construct: name, expression: call.text, position: call.start };
  const literal = (...nodes: (Capture | undefined)[]) => (nodes.length > 0 && nodes.every(isLiteral) ? { literal: true as const } : {});
  switch (name) {
    case "eval":
      return { kind: "exec", ...at, ...literal(args[0]) };
    case "assert":
      return args[0] !== undefined && STRING_TYPES.has(args[0].nodeType) ? { kind: "exec", ...at, ...literal(args[0]) } : undefined;
    case "preg_replace": {
      const pattern = args[0];
      if (pattern === undefined || !isLiteral(pattern) || !STRING_TYPES.has(pattern.nodeType) || pattern.nodeType === "heredoc" || pattern.nodeType === "nowdoc") return undefined;
      return patternModifiers(pattern)?.includes("e") ? { kind: "exec", ...at, ...literal(args[1]) } : undefined;
    }
    case "create_function":
      return { kind: "exec", ...at, ...literal(args[0], args[1]) };
  }
  const index = CALLERS.has(name) ? 0 : CALLBACK_ARGUMENT.get(name);
  if (index === undefined || index >= args.length) return undefined;
  return captures.isStaticCallable(args[index]) ? undefined : { kind: "dispatch", ...at };
}

/** Every exec and dispatch site in a file. `declared` holds the lower-cased functions the repository declares. */
function codeSites(captures: FileCaptures, declared: ReadonlySet<string>): Site[] {
  const sites: Site[] = [];
  // Strict, since a callee may itself be a call of the same span (`$f()()`).
  const calls = captures.get("call");
  const callees = captures.get("callee");
  const calleeOf = new Map<Capture, Capture>();
  innermostEach(calls, callees, true).forEach((call, i) => {
    if (call !== undefined) calleeOf.set(call, callees[i]!);
  });
  for (const call of calls) {
    const callee = calleeOf.get(call);
    if (callee === undefined) continue;
    if (NAME_TYPES.has(callee.nodeType)) {
      const written = callee.text.replace(/^\\/, "");
      if (written.includes("\\")) continue;
      const name = written.toLowerCase();
      if (declared.has(name) || (!EXEC_FUNCTIONS.has(name) && !CALLERS.has(name) && !CALLBACK_ARGUMENT.has(name))) continue;
      const site = namedCallSite(name, call, captures);
      if (site !== undefined) sites.push(site);
    } else if (!captures.isStaticCallable(callee)) {
      sites.push({ kind: "dispatch", construct: "variable-function", expression: call.text, position: call.start });
    }
  }
  // Each call's one name is owned by it; strict, since a name may itself be a call of the same span (`$o->{$a->b()}()`).
  const byValue = (calls: string, names: string, construct: string) => {
    const named = captures.get(names);
    innermostEach(captures.get(calls), named, true).forEach((call, i) => {
      if (call !== undefined && named[i]!.nodeType !== "name") sites.push({ kind: "dispatch", construct, expression: call.text, position: call.start });
    });
  };
  byValue("method-call", "method-name", "variable-method");
  byValue("static-call", "static-name", "variable-static-method");
  for (const created of captures.get("new")) sites.push({ kind: "dispatch", construct: "variable-new", expression: created.text, position: created.start });
  return sites;
}

/** Names each site's enclosing scope. */
function scopeNamer(captures: FileCaptures): (at: SourcePosition) => string | undefined {
  const functions = captures.get("function");
  const methods = captures.get("method-decl");
  const closures = captures.get("closure");
  const types = [...captures.get("type"), ...captures.get("anonymous-class")];
  const scopes = [...functions, ...methods, ...closures];
  const owners = [...scopes, ...types];
  const names = new Map<Capture, string>();
  for (const label of ["function-name", "method-decl-name", "type-name"]) {
    const captured = captures.get(label);
    innermostEach(owners, captured).forEach((owner, i) => {
      if (owner !== undefined && !names.has(owner)) names.set(owner, captured[i]!.text);
    });
  }
  const typeOf = new Map<Capture, Capture | undefined>();
  innermostEach(types, methods).forEach((t, i) => typeOf.set(methods[i]!, t));
  const parentOf = new Map<Capture, Capture | undefined>();
  innermostEach(scopes, closures, true).forEach((p, i) => parentOf.set(closures[i]!, p));
  const methodSet = new Set(methods);
  const closureSet = new Set(closures);
  const nameOf = (scope: Capture): string => {
    if (closureSet.has(scope)) {
      const parent = parentOf.get(scope);
      return parent === undefined ? "{closure}" : `{closure:${nameOf(parent)}}`;
    }
    if (methodSet.has(scope)) {
      const type = typeOf.get(scope);
      const owner = type === undefined ? undefined : (names.get(type) ?? "class@anonymous");
      return owner === undefined ? names.get(scope)! : `${owner}::${names.get(scope)}`;
    }
    return names.get(scope)!;
  };
  return (at) => {
    const point: Capture = { name: "", nodeType: "", text: "", start: at, end: at };
    const [scope] = innermostEach(scopes, [point]);
    return scope === undefined ? undefined : nameOf(scope);
  };
}

/** Each include in `file` whose path is not computable. */
function includeSites(file: PackSourceFile, constant: ConstantLookup): Site[] {
  const dynamic = readWrittenImports(file).filter((w) => isInclude(w) && isDynamicIncludePath(w.specifier, file.path, constant));
  if (dynamic.length === 0) return [];
  const readsHost = hostReader(file);
  return dynamic.map((w) => ({
    kind: "include",
    construct: readsHost(w.specifier, w.position) ? "host-include" : "dynamic-include",
    expression: w.specifier,
    position: w.position,
  }));
}

/** Lower-cased names of the functions any of `files` declares. */
function declaredFunctions(files: readonly PackSourceFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    for (const c of file.captures[QUERY] ?? []) if (c.name === `${PREFIX}declared`) names.add(c.text.toLowerCase());
  }
  return names;
}

const before = (a: SourcePosition, b: SourcePosition): number => a.line - b.line || a.column - b.column;

/** Every dynamic-code site of each file, in document order; files without one are left out. */
export function readDynamicCode(files: readonly PackSourceFile[]): Map<string, DynamicCodeFact[]> {
  const declared = declaredFunctions(files);
  const constant = repositoryConstants(files);
  const out = new Map<string, DynamicCodeFact[]>();
  for (const file of files) {
    const captures = new FileCaptures(file);
    const sites = [...codeSites(captures, declared), ...includeSites(file, constant)];
    if (sites.length === 0) continue;
    const scopeAt = scopeNamer(captures);
    out.set(
      file.path,
      sites
        .sort((a, b) => before(a.position, b.position))
        .map((site) => {
          const scope = scopeAt(site.position);
          return { ...site, ...(scope === undefined ? {} : { scope }) };
        }),
    );
  }
  return out;
}

/** The `[php-dynamic-exec]` and `[php-dynamic-dispatch]` notices; empty when there are none. */
export function dynamicCodeNotices(facts: ReadonlyMap<string, readonly DynamicCodeFact[]>): string[] {
  const of = (kind: DynamicCodeFact["kind"]) => [...facts].flatMap(([path, list]) => list.filter((f) => f.kind === kind).map((f) => ({ path, ...f })));
  const exec = of("exec");
  const dispatch = of("dispatch");
  const notices: string[] = [];
  if (exec.length > 0) {
    const literal = exec.filter((f) => f.literal).length;
    const one = exec.length === 1;
    notices.push(
      `PHP: [${PHP_DYNAMIC_EXEC}] ${exec.length} site${one ? " runs" : "s run"} a string as code: ${noticeLocations(exec)}${literal === 0 ? "" : `; ${literal} with literal code`}.`,
    );
  }
  if (dispatch.length > 0) {
    const one = dispatch.length === 1;
    notices.push(`PHP: [${PHP_DYNAMIC_DISPATCH}] ${dispatch.length} site${one ? " chooses" : "s choose"} what to run from a value: ${noticeLocations(dispatch)}.`);
  }
  return notices;
}

const GRAMMAR = "tree-sitter-php@0.25.1";
const MANUAL = "https://www.php.net/manual/en/";
const rule = (page: string): RuleProvenance => ({ verifiedAgainst: [GRAMMAR, "PHP manual"], verifiedOn: "2026-11-16", source: `${MANUAL}${page}` });

const PROVENANCE: Readonly<Record<string, RuleProvenance>> = {
  [QUERY]: { verifiedAgainst: [GRAMMAR], verifiedOn: "2026-11-16", source: "https://github.com/tree-sitter/tree-sitter-php/blob/v0.25.1/php/src/node-types.json" },
  eval: rule("function.eval.php"),
  // A string assertion is evaluated as PHP code (removed in 8.0).
  assert: rule("function.assert.php"),
  // The `e` modifier evaluated the replacement as PHP code (removed in 7.0).
  "preg-replace-e": rule("reference.pcre.pattern.modifiers.php"),
  "create-function": rule("function.create-function.php"),
  "call-user-func": rule("function.call-user-func.php"),
  callables: rule("language.types.callable.php"),
  "variable-functions": rule("functions.variable-functions.php"),
  "variable-new": rule("language.oop5.basic.php#language.oop5.basic.new"),
  includes: rule("function.include.php"),
};

export const phpDynamicCode: FrameworkPack = {
  id: "php-dynamic",
  produces: ["dynamicCode"],
  // A getter, so the path is computed on first use rather than at import.
  get queries() {
    return [{ name: QUERY, path: join(PHP_PACKAGE.queryDir("php-dynamic"), `${QUERY}.scm`) }];
  },
  provenance: PROVENANCE,
  read(files: readonly PackSourceFile[], kinds: readonly FactKind[]): FrameworkFacts {
    if (!kinds.includes("dynamicCode")) return { facts: new Map(), notices: [] };
    const found = readDynamicCode(files);
    const facts = new Map<string, Omit<FileFacts, "path">>([...found].map(([path, dynamicCode]) => [path, { dynamicCode }]));
    return { facts, notices: dynamicCodeNotices(found) };
  },
};
