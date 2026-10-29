/**
 * What the Python web framework rules (`fastapi.ts`, `flask.ts`,
 * `django.ts`) read from a parsed file, and the rules they share: string
 * literals, the `${expression}` form of a value that is not one, how a
 * prefix meets a path, and how a name is followed into another file.
 *
 * Each framework's query (`queries/<framework>/<framework>.scm`) captures
 * the same parts under its own prefix: `<prefix>.argument`, `.keyword`,
 * `.value`, `.item`, `.sequence`, `.assignment`, `.target`, `.assigned`,
 * `.alias` and `.aliased`. The Python queries supply the rest: `calls`
 * (callee, receiver, argument list), `definitions` (decorators and the
 * functions they decorate) and `imports`.
 *
 * @module lang-python/python-web
 */

import type { SourcePosition } from "@n-dx/lang-kit";
import { callSites, contains, innermostEach, type Capture, type FrameworkContext, type PackSourceFile } from "@n-dx/lang-runtime";

// ── Captures ────────────────────────────────────────────────────────────────

const spanKey = (c: Capture): string => `${c.start.line}:${c.start.column}-${c.end.line}:${c.end.column}`;

const sameSpan = (a: Capture, b: Capture): boolean => spanKey(a) === spanKey(b);

/** A dotted name as written, without the whitespace Python allows inside it. */
export const dotted = (text: string): string => text.replace(/\s+/g, "");

/** The last name of a dotted name: `views.home` → `home`. */
export const lastName = (text: string): string => {
  const bare = dotted(text);
  return bare.slice(bare.lastIndexOf(".") + 1);
};

/** Captures named `name`, each node once (a node two patterns match is captured twice), comments left out. */
function named(captures: readonly Capture[], name: string): Capture[] {
  const seen = new Set<string>();
  return captures.filter((c) => {
    if (c.name !== name || c.nodeType === "comment") return false;
    const key = spanKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Each of `captured` under the smallest of `owners` that contains it and is not it (a list entry that is itself a list). */
function byOwner(owners: readonly Capture[], captured: readonly Capture[]): Map<Capture, Capture[]> {
  const owned = new Map<Capture, Capture[]>();
  const found = innermostEach(owners, captured, true);
  captured.forEach((c, i) => {
    const owner = found[i];
    if (!owner) return;
    const list = owned.get(owner);
    if (list) list.push(c);
    else owned.set(owner, [c]);
  });
  return owned;
}

// ── One file ────────────────────────────────────────────────────────────────

/** A call with its arguments, when the framework's query captured them. */
export interface WebCall {
  /** The called name: `get` in `router.get(…)`. */
  readonly callee: string;
  /** The receiver as written, whitespace removed: `router`, `views.SiteView`. */
  readonly receiver?: string;
  /** The receiver's node: a call for `requests.Session().get(…)`. */
  readonly receiverNode?: Capture;
  readonly invocation: Capture;
  /** Positional arguments in order, up to the first `*args`. */
  readonly positional: readonly Capture[];
  /** Keyword arguments by name: the value nodes. */
  readonly keywords: ReadonlyMap<string, Capture>;
  /** How many arguments the query captured, `*args` and `**kwargs` included. */
  readonly arity: number;
}

/** The argument at `position`, else the one named `keyword`. */
export const argument = (call: WebCall, position: number | undefined, keyword: string): Capture | undefined =>
  (position === undefined ? undefined : call.positional[position]) ?? call.keywords.get(keyword);

/** What an imported name is bound to: `from <module> import <name>`, or `import <module>`. */
export interface Binding {
  readonly module: string;
  readonly name?: string;
  /** Where the import binds it. */
  readonly at: SourcePosition;
  /** The import is inside a `def` or `class`, so it binds no module-level name. */
  readonly nested?: true;
}

/** A name bound by an assignment; `augmented` for `+=`. */
export interface WebAssignment {
  readonly target: string;
  readonly targetNode: Capture;
  readonly value: Capture;
  readonly augmented: boolean;
  /** Assignments in a function or class do not bind names in the module. */
  readonly nested?: true;
}

/** A decorator on a function, with the function's name. */
export interface Decorated {
  readonly decorator: Capture;
  readonly handler: string;
}

export interface WebFile {
  readonly path: string;
  readonly calls: readonly WebCall[];
  /** The call whose whole invocation is `node`. */
  callAt(node: Capture): WebCall | undefined;
  /** The entries of a list or tuple the query captured as a sequence, in order; empty otherwise. */
  itemsOf(node: Capture): readonly Capture[];
  /** Every captured sequence (list or tuple). */
  readonly sequences: readonly Capture[];
  readonly assignments: readonly WebAssignment[];
  /** Imported names by local name; a later import of a name replaces an earlier one. */
  readonly bindings: ReadonlyMap<string, Binding>;
  /** Where each name is last bound at module level by an assignment, `def` or `class`. */
  readonly moduleBound: ReadonlyMap<string, SourcePosition>;
  readonly decorated: readonly Decorated[];
}

/** Read one parsed file's web syntax: its captures must include the Python queries' and the framework query's (`prefix`). */
export function readWebFile(file: PackSourceFile, prefix: string): WebFile {
  const own = file.captures[prefix] ?? [];
  const mine = (part: string): Capture[] => named(own, `${prefix}.${part}`);

  // Calls, with the arguments the framework's query captured.
  const sites = callSites(file.captures.calls ?? []);
  const args = byOwner(
    sites.map((s) => s.arguments),
    mine("argument"),
  );
  const keywordArgs = mine("argument").filter((a) => a.nodeType === "keyword_argument");
  const keywordNames = byOwner(keywordArgs, mine("keyword"));
  const keywordValues = byOwner(keywordArgs, mine("value"));
  const calls: WebCall[] = [];
  for (const site of sites) {
    if (!site.invocation || !site.name) continue;
    const positional: Capture[] = [];
    const keywords = new Map<string, Capture>();
    let splat = false;
    const captured = args.get(site.arguments) ?? [];
    for (const arg of captured) {
      if (arg.nodeType === "keyword_argument") {
        const name = keywordNames.get(arg)?.[0];
        const value = keywordValues.get(arg)?.[0];
        if (name && value) keywords.set(name.text, value);
      } else if (arg.nodeType === "list_splat" || arg.nodeType === "dictionary_splat") {
        splat = true; // positions after `*args` are not known
      } else if (!splat) {
        positional.push(arg);
      }
    }
    calls.push({
      callee: site.name.text,
      ...(site.receiver ? { receiver: dotted(site.receiver.text), receiverNode: site.receiver } : {}),
      invocation: site.invocation,
      positional,
      keywords,
      arity: captured.length,
    });
  }
  const callsBySpan = new Map(calls.map((c) => [spanKey(c.invocation), c]));

  const sequences = mine("sequence");
  const items = new Map([...byOwner(sequences, mine("item"))].map(([sequence, entries]) => [spanKey(sequence), entries]));

  const assignmentNodes = mine("assignment");
  const definitions = file.captures.definitions ?? [];
  const scopes = [...named(definitions, "class.declaration"), ...named(definitions, "function.declaration")];
  const assignmentScopes = innermostEach(scopes, assignmentNodes);
  const targets = byOwner(assignmentNodes, mine("target"));
  const values = byOwner(assignmentNodes, mine("assigned"));
  const assignments = assignmentNodes.flatMap((node, i): WebAssignment[] => {
    const target = targets.get(node)?.[0];
    const value = values.get(node)?.[0];
    return target && value ? [{ target: target.text, targetNode: target, value, augmented: node.nodeType === "augmented_assignment", ...(assignmentScopes[i] ? { nested: true as const } : {}) }] : [];
  });

  return {
    path: file.path,
    calls,
    callAt: (node) => callsBySpan.get(spanKey(node)),
    itemsOf: (node) => items.get(spanKey(node)) ?? [],
    sequences,
    assignments,
    bindings: readBindings(file, mine("aliased"), mine("alias")),
    moduleBound: readModuleBound(file, mine("binding")),
    decorated: readDecorated(file),
  };
}

/** Local names the file's imports bind, aliases included. */
function readBindings(file: PackSourceFile, aliased: readonly Capture[], aliases: readonly Capture[]): Map<string, Binding> {
  const imports = file.captures.imports ?? [];
  const of = (name: string): Capture[] => named(imports, name);
  const aliasAt = new Map<string, string>();
  for (const node of aliased) {
    const alias = aliases.find((a) => contains(node, a));
    if (alias) aliasAt.set(`${node.start.line}:${node.start.column}`, alias.text);
  }
  const aliasOf = (c: Capture): string | undefined => aliasAt.get(`${c.start.line}:${c.start.column}`);
  const statements = of("import.statement");
  const froms = of("import.from");

  const entries: Array<[SourcePosition, string, Binding]> = [];
  for (const module of of("import.module")) {
    const spec = dotted(module.text);
    const alias = aliasOf(module);
    // `import a.b` binds `a`; `import a.b as c` binds `c` to `a.b`.
    const at = module.start;
    entries.push(alias ? [at, alias, { module: spec, at }] : [at, spec.split(".")[0]!, { module: spec.split(".")[0]!, at }]);
  }
  const names = of("import.name");
  const statementOf = innermostEach(statements, names);
  const fromOf = new Map([...byOwner(statements, froms)].map(([statement, found]) => [statement, found[0]!]));
  for (const [i, name] of names.entries()) {
    const statement = statementOf[i];
    const from = statement && fromOf.get(statement);
    if (!from) continue;
    const text = dotted(name.text);
    entries.push([name.start, aliasOf(name) ?? text, { module: dotted(from.text), name: text, at: name.start }]);
  }
  const definitions = file.captures.definitions ?? [];
  const declarations = [...named(definitions, "class.declaration"), ...named(definitions, "function.declaration")];
  const nested = (at: SourcePosition): boolean =>
    declarations.some((d) => comparePositions(d.start, at) < 0 && comparePositions(at, d.end) < 0);
  entries.sort(([a], [b]) => comparePositions(a, b));
  return new Map(entries.map(([at, local, binding]) => [local, nested(at) ? { ...binding, nested: true } : binding]));
}

const comparePositions = (a: SourcePosition, b: SourcePosition): number => a.line - b.line || a.column - b.column;

/**
 * Names bound at module level other than by import: an assignment the
 * `variables` query captured (an annotation alone binds nothing), and a
 * `def` or `class` inside no other definition. A later one replaces an earlier one.
 */
function readModuleBound(file: PackSourceFile, bindings: readonly Capture[]): Map<string, SourcePosition> {
  const entries: Array<[string, SourcePosition]> = [];
  const variables = file.captures.variables ?? [];
  const statements = named(variables, "variable.declaration");
  const variableNames = byOwner(statements, named(variables, "variable.name"));
  for (const statement of statements) {
    const name = variableNames.get(statement)?.[0];
    if (name && /^\s*(?::[^=]*)?=/.test(statement.text.slice(name.text.length))) entries.push([name.text, name.start]);
  }
  const definitions = file.captures.definitions ?? [];
  const of = (name: string): Capture[] => named(definitions, name);
  const declarations = [...of("class.declaration"), ...of("function.declaration")];
  const bindingScopes = innermostEach(declarations, bindings);
  bindings.forEach((binding, i) => {
    if (!bindingScopes[i]) entries.push([binding.text, binding.start]);
  });
  const definitionNames = byOwner(declarations, [...of("class.name"), ...of("function.name")]);
  const enclosing = innermostEach(declarations, declarations, true);
  declarations.forEach((declaration, i) => {
    const name = definitionNames.get(declaration)?.[0];
    if (name && enclosing[i] === undefined) entries.push([name.text, name.start]);
  });
  entries.sort(([, a], [, b]) => comparePositions(a, b));
  return new Map(entries);
}

/** Each decorator on a function, with the function's name. */
function readDecorated(file: PackSourceFile): Decorated[] {
  const definitions = file.captures.definitions ?? [];
  const of = (name: string): Capture[] => named(definitions, name);
  const declarations = of("decorated.declaration");
  const definitionsByDeclaration = byOwner(declarations, of("decorated.definition"));
  const functions = of("function.declaration");
  const functionNames = byOwner(functions, of("function.name"));
  const functionAt = new Map(functions.map((f) => [spanKey(f), f]));
  const decorators = of("decorated.decorator");
  const declarationOf = innermostEach(declarations, decorators);
  const out: Decorated[] = [];
  for (const [i, decorator] of decorators.entries()) {
    const declaration = declarationOf[i];
    // A nested decorated definition belongs to its own, smaller declaration.
    const definition = declaration && definitionsByDeclaration.get(declaration)?.[0];
    const fn = definition && functionAt.get(spanKey(definition));
    const name = fn && functionNames.get(fn)?.[0];
    if (name) out.push({ decorator, handler: name.text });
  }
  return out;
}

// ── Values ──────────────────────────────────────────────────────────────────

/** A route path, prefix or method: a literal's value, or the expression as written in `${…}` form. */
export interface WebValue {
  readonly text: string;
  /** False when any part of it is not a literal (an f-string, a name, a call). */
  readonly literal: boolean;
}

const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["\\", "\\"],
  ["'", "'"],
  ['"', '"'],
  ["n", "\n"],
  ["t", "\t"],
  ["r", "\r"],
  ["\n", ""],
]);

/** A string body's value: escapes processed unless raw; Python keeps the backslash of an unknown escape. */
function unescape(body: string, raw: boolean): string {
  if (raw) return body;
  return body.replace(/\\(.|\n)/g, (all, c: string) => SIMPLE_ESCAPES.get(c) ?? all);
}

/** The end of an f-string replacement field's expression: before a top-level `!conversion`, `:format` or `=`. */
function fieldExpression(field: string): string {
  let depth = 0;
  let quote: string | undefined;
  for (let i = 0; i < field.length; i++) {
    const c = field[i]!;
    if (quote) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && ((c === "!" && field[i + 1] !== "=") || c === ":")) return field.slice(0, i);
  }
  return field;
}

/** One part of a string's value: literal text, or an f-string replacement field's expression. */
export type StringPart = { readonly literal: string } | { readonly field: string };

/** An f-string body's parts: literal text (`{{`/`}}` as braces) and each replacement field's expression. */
function fstringParts(body: string, raw: boolean): StringPart[] {
  const parts: StringPart[] = [];
  let literal = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if ((c === "{" || c === "}") && body[i + 1] === c) {
      literal += c;
      i++;
      continue;
    }
    if (c !== "{") {
      literal += c;
      continue;
    }
    let depth = 1;
    let j = i + 1;
    for (; j < body.length && depth > 0; j++) {
      if (body[j] === "{") depth++;
      else if (body[j] === "}") depth--;
    }
    if (literal !== "") parts.push({ literal: unescape(literal, raw) });
    literal = "";
    parts.push({ field: fieldExpression(body.slice(i + 1, j - 1)).trim().replace(/=$/, "").trim() });
    i = j - 1;
  }
  if (literal !== "") parts.push({ literal: unescape(literal, raw) });
  return parts;
}

/** A string literal's parts, and whether any piece of it is an f-string. */
function readString(text: string): { readonly parts: StringPart[]; readonly fstring: boolean } | undefined {
  let i = 0;
  let pieces = 0;
  let fstring = false;
  const parts: StringPart[] = [];
  const push = (part: StringPart): void => {
    const last = parts.at(-1);
    if ("literal" in part && last !== undefined && "literal" in last) parts[parts.length - 1] = { literal: last.literal + part.literal };
    else parts.push(part);
  };
  const skipSpace = (): void => {
    for (;;) {
      const rest = text.slice(i);
      const space = /^(\s+|\\\n|#[^\n]*)/.exec(rest);
      if (!space) return;
      i += space[0].length;
    }
  };
  for (skipSpace(); i < text.length; skipSpace()) {
    const start = /^([A-Za-z]{0,2})("""|'''|"|')/.exec(text.slice(i));
    if (!start) return undefined;
    const prefix = start[1]!.toLowerCase();
    const quote = start[2]!;
    let j = i + start[0].length;
    let body = "";
    for (;;) {
      if (j >= text.length) return undefined;
      if (text.startsWith(quote, j)) break;
      if (text[j] === "\\" && j + 1 < text.length) {
        body += text.slice(j, j + 2);
        j += 2;
        continue;
      }
      body += text[j];
      j++;
    }
    i = j + quote.length;
    pieces++;
    const raw = prefix.includes("r");
    if (prefix.includes("f")) {
      fstring = true;
      fstringParts(body, raw).forEach(push);
    } else if (body !== "") {
      push({ literal: unescape(body, raw) });
    }
  }
  return pieces === 0 ? undefined : { parts, fstring };
}

/**
 * The parts of a string literal as written (`"/a"`, `r'^a$'`, `"a" "b"`,
 * `f"{x}/a"`), adjacent literal text merged; undefined when `text` is not
 * one. An empty string has no parts.
 */
export const stringParts = (text: string): StringPart[] | undefined => readString(text)?.parts;

/**
 * The value of a string literal as written (`"/a"`, `r'^a$'`, `"a" "b"`,
 * `f"{x}/a"`), or undefined when `text` is not one. An f-string is not a
 * literal; its replacement fields take the `${…}` form.
 */
export function stringValue(text: string): WebValue | undefined {
  const read = readString(text);
  if (read === undefined) return undefined;
  return { text: read.parts.map((p) => ("literal" in p ? p.literal : `\${${p.field}}`)).join(""), literal: !read.fstring };
}

/**
 * A path, prefix or method as written: a string literal's value, else the
 * expression in `${…}` form (`settings.API_V1_STR` → `${settings.API_V1_STR}`).
 */
export function webValue(node: Capture): WebValue {
  const text = node.nodeType === "parenthesized_expression" ? node.text.replace(/^\(([\s\S]*)\)$/, "$1") : node.text;
  if (node.nodeType === "string" || node.nodeType === "concatenated_string" || node.nodeType === "parenthesized_expression") {
    const value = stringValue(text);
    if (value) return value;
  }
  return { text: `\${${node.text.replace(/\s+/g, " ").trim()}}`, literal: false };
}

/**
 * A prefix and a path joined with exactly one slash between them, both kept
 * otherwise as written, so a trailing slash survives (`/items` and `/` give
 * `/items/`, as FastAPI and Django concatenate them); an empty side gives
 * the other unchanged. For composing prefixes; a route's full path is
 * {@link joinWebPath}.
 */
export function joinPrefix(prefix: string, path: string): string {
  if (path === "") return prefix;
  if (prefix === "") return path;
  // Trimmed by a loop: `/\/+$/` is quadratic on many `/` followed by another character.
  let end = prefix.length;
  while (end > 0 && prefix.charCodeAt(end - 1) === 0x2f) end--;
  return `${prefix.slice(0, end)}/${path.replace(/^\/+/, "")}`;
}

/**
 * A route's full path: {@link joinPrefix}, then a leading `/` unless it
 * starts with one, with a placeholder (`${settings.API_V1_STR}/items/`) or
 * with a regular expression's `^` (`re_path` patterns are kept as written).
 */
export function joinWebPath(prefix: string, path: string): string {
  const joined = joinPrefix(prefix, path);
  return joined.startsWith("/") || joined.startsWith("^") || joined.startsWith("${") ? joined : `/${joined}`;
}

// ── Across files ────────────────────────────────────────────────────────────

/** `from <module> import <name>` as a module path: `.` and `x` give `.x`, `a` and `b` give `a.b`. */
const submodule = (module: string, name: string): string => (module.endsWith(".") ? `${module}${name}` : `${module}.${name}`);

/** A name defined in a file. */
export interface Defined {
  readonly file: string;
  readonly name: string;
}

/** How far a chain of re-exports is followed. */
const MAX_REEXPORTS = 8;

/** Follows names and modules through the files of one analysis. */
export class WebProject {
  private readonly byPath: ReadonlyMap<string, WebFile>;

  constructor(
    readonly files: readonly WebFile[],
    private readonly context: FrameworkContext | undefined,
  ) {
    this.byPath = new Map(files.map((f) => [f.path, f]));
  }

  file(path: string): WebFile | undefined {
    return this.byPath.get(path);
  }

  /** The parsed file of the module `specifier` names from `from`; undefined without a resolver. */
  module(from: string, specifier: string): string | undefined {
    const found = this.context?.module?.(from, specifier);
    return found !== undefined && this.byPath.has(found) ? found : undefined;
  }

  /** The module file a dotted name written in `from` refers to: `items` after `from app.routes import items`. */
  moduleOf(from: string, segments: readonly string[]): string | undefined {
    const base = this.importedModule(from, segments[0]!, 0);
    return base && this.module(base.file, [base.specifier, ...segments.slice(1)].reduce((m, s) => submodule(m, s)));
  }

  /**
   * The module `name` is bound to by an import in `file`, as a specifier
   * written in the file it resolves from. `from pkg import name` gives
   * `pkg`'s attribute: when `pkg/__init__.py` binds `name`, the module it
   * imports there (re-exports followed); the submodule `pkg.name` only when
   * it binds nothing by that name. Undefined when the name is bound to
   * something other than a module.
   */
  private importedModule(file: string, name: string, depth: number): { file: string; specifier: string } | undefined {
    const web = this.file(file);
    const binding = web?.bindings.get(name);
    if (!binding) return undefined;
    // Python's last module-level binding wins: a name bound again after its import is not the imported module.
    const bound = web!.moduleBound.get(name);
    if (bound !== undefined && comparePositions(binding.at, bound) < 0) return undefined;
    if (binding.name === undefined) return { file, specifier: binding.module };
    const pkg = this.module(file, binding.module);
    if (pkg !== undefined && pkg !== file) {
      // Only a module-level binding is `pkg`'s attribute; an import inside a `def` or `class` is not.
      const init = this.file(pkg)!;
      const imported = init.bindings.get(binding.name);
      if (imported && !imported.nested) {
        return depth + 1 < MAX_REEXPORTS ? this.importedModule(pkg, binding.name, depth + 1) : undefined;
      }
      if (init.moduleBound.has(binding.name)) return undefined;
    }
    return { file, specifier: submodule(binding.module, binding.name) };
  }

  /**
   * Where the name written in `from` (`router`, `items.router`) is defined,
   * by `defines`: in the file itself, through `from m import name` (and any
   * re-exports after it), or as an attribute of an imported module.
   */
  defined(from: string, text: string, defines: (file: string, name: string, at?: SourcePosition) => boolean): Defined | undefined {
    const segments = dotted(text).split(".");
    if (segments.some((s) => !/^[A-Za-z_]\w*$/.test(s))) return undefined;
    if (segments.length === 1) return this.follow(from, segments[0]!, defines, 0);
    const module = this.moduleOf(from, segments.slice(0, -1));
    return module === undefined ? undefined : this.follow(module, segments.at(-1)!, defines, 0);
  }

  private follow(file: string, name: string, defines: (file: string, name: string, at?: SourcePosition) => boolean, depth: number): Defined | undefined {
    const web = this.file(file);
    const binding = web?.bindings.get(name);
    const bound = web?.moduleBound.get(name);
    const importWins = binding && (!binding.nested || depth === 0) && (bound === undefined || comparePositions(binding.at, bound) > 0);
    if (!importWins) {
      // Factory-local routers remain useful in their own file, but cannot be a package attribute.
      return defines(file, name, bound) && (depth === 0 || bound !== undefined) ? { file, name } : undefined;
    }
    if (!binding.name || depth >= MAX_REEXPORTS) return undefined;
    // `from pkg import name` gives `pkg`'s attribute: what `pkg/__init__.py` binds to `name`
    // (a re-export of `pkg/name.py`'s object included), and the submodule only when it binds nothing.
    const next = this.module(file, binding.module);
    if (next === undefined) return undefined;
    if (next === file || !this.binds(next, binding.name)) {
      if (this.module(file, submodule(binding.module, binding.name)) !== undefined) return undefined;
    }
    return this.follow(next, binding.name, defines, depth + 1);
  }

  /** Whether `file` binds `name` at module level: a definition `defines` accepts, an import, an assignment, `def` or `class`. */
  private binds(file: string, name: string): boolean {
    const web = this.file(file);
    return web?.moduleBound.has(name) === true || (web?.bindings.get(name) !== undefined && !web.bindings.get(name)!.nested);
  }
}

// ── Notices ─────────────────────────────────────────────────────────────────

/** A value a rule kept in `${…}` form, skipped or did not follow. */
export interface WebNote {
  readonly path: string;
  readonly position: SourcePosition;
  /** What the value would have given: `path`, `prefix`, `method`, `include`… */
  readonly what: string;
  /** The value as written. */
  readonly text: string;
}

/** Notes keyed by where they are, so a value reached twice is counted once. */
export class WebNotes {
  private readonly notes = new Map<string, WebNote>();

  /** `text` defaults to the node's text, whitespace collapsed. */
  add(path: string, node: Capture, what: string, text = node.text.replace(/\s+/g, " ").trim()): void {
    const key = `${path}:${spanKey(node)}`;
    if (!this.notes.has(key)) this.notes.set(key, { path, position: node.start, what, text });
  }

  /** In file and position order. */
  list(): WebNote[] {
    return [...this.notes.values()].sort(
      (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.position.line - b.position.line || a.position.column - b.position.column,
    );
  }
}

/** How many notices name a location before the rest are counted. */
const NOTICE_LOCATIONS = 5;

/**
 * One notice for `notes`, undefined when there are none:
 * `<framework>: <subject>: <file>:<line> (<what> <text>), …, and N more.`
 */
export function webNotice(framework: string, notes: readonly WebNote[], subject: (count: number) => string): string | undefined {
  if (notes.length === 0) return undefined;
  const where = notes.slice(0, NOTICE_LOCATIONS).map((n) => `${n.path}:${n.position.line} (${n.what} ${n.text})`);
  const more = notes.length > NOTICE_LOCATIONS ? `, and ${notes.length - NOTICE_LOCATIONS} more` : "";
  return `${framework}: ${subject(notes.length)}: ${where.join(", ")}${more}.`;
}

/** The subject of the notice for paths and prefixes kept in `${…}` form. */
export const keptSubject = (count: number): string =>
  count === 1
    ? "1 route path or prefix is not a literal and is kept as written in ${…} form"
    : `${count} route paths or prefixes are not literals and are kept as written in \${…} form`;
