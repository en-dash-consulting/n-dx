/**
 * Legacy PHP autoloaders: the functions PHP calls with a class name to load
 * it, read as text and applied to class names the way they would run.
 *
 * **Autoloaders**: a function named `__autoload`
 * (https://www.php.net/manual/en/function.autoload.php, removed in PHP 8),
 * and each callback given to `spl_autoload_register()`
 * (https://www.php.net/manual/en/function.spl-autoload-register.php): a
 * closure or arrow function, a function name (`'load'`), or a static or
 * instance method (`'Loader::load'`, `array('Loader', 'load')`,
 * `array($this, 'load')`, `[__CLASS__, 'load']`, `[self::class, 'load']`,
 * `[Loader::class, 'load']`) declared in the repository. Its first parameter
 * is the class name.
 *
 * **Patterns**: an include in the autoloader's body whose path is computable
 * (`php-includes.ts`) once the class name is known: literals, `__DIR__`,
 * constants, the parameter and variables assigned in the body before the
 * include (`=`, then `.=`), through `str_replace()`, `strtr()`,
 * `strtolower()`, `strtoupper()` and `ltrim()`/`rtrim()`/`trim()`. Such an
 * include is searched for as an include written in the autoloader's file.
 * An include that does not depend on the class is an ordinary include, not
 * a pattern.
 *
 * Each autoloader with no pattern, and each registration naming nothing the
 * repository declares once (a variable, an object, an undeclared function,
 * or no callback: PHP's default `spl_autoload`), is a notice with its
 * location.
 *
 * @module lang-php/php-autoloaders
 */

import type { SourcePosition, WrittenImport } from "@n-dx/lang-kit";
import { contains, innermost, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";
import { readWrittenImports } from "./php-imports.js";
import { isInclude, owned, type PhpIncludes } from "./php-includes.js";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const before = (a: SourcePosition, b: SourcePosition): boolean => a.line < b.line || (a.line === b.line && a.column < b.column);

const inside = (span: Capture, at: SourcePosition): boolean => !before(at, span.start) && before(at, span.end);

/** A variable's name without its `$`. */
const variableName = (text: string): string => text.replace(/^\$/, "");

/** The last segment of a function or class name, lowercase: callbacks are matched by it. */
const shortName = (name: string): string => name.slice(name.lastIndexOf("\\") + 1).toLowerCase();

/** Two class names whose computed paths differ when a path depends on the class. */
const PROBES = ["NdxProbe_One", "NdxProbe\\Two"] as const;

interface Assignment {
  readonly name: string;
  /** A compound operator (`.=`); undefined for `=`. */
  readonly operator?: string;
  readonly value: string;
  readonly start: SourcePosition;
}

/** A function, method or closure that could be an autoloader. */
interface Body {
  readonly file: string;
  readonly span: Capture;
  /** The first parameter's name, without `$`. */
  readonly parameter?: string;
}

/** One autoloader with the includes in its body that depend on the class name. */
interface Loader {
  readonly body: Body;
  readonly includes: readonly WrittenImport[];
  readonly assignments: readonly Assignment[];
}

interface Registration {
  readonly call: Capture;
  readonly callback?: Capture;
  /** The class the call is written in, for `$this` and `__CLASS__`. */
  readonly enclosingClass?: string;
}

/** What one file holds for autoloading. */
interface FileFacts {
  readonly path: string;
  readonly includes: readonly WrittenImport[];
  readonly assignments: readonly Assignment[];
  readonly functions: ReadonlyArray<{ readonly name: string; readonly body: Body }>;
  readonly methods: ReadonlyArray<{ readonly className: string; readonly name: string; readonly body: Body }>;
  readonly registrations: readonly Registration[];
  readonly parameters: readonly Capture[];
}

function readFacts(file: PackSourceFile): FileFacts {
  const imports = file.captures.imports ?? [];
  const defs = file.captures.definitions ?? [];
  const named = (list: readonly Capture[], name: string): Capture[] => list.filter((c) => c.name === name);
  const parameters = named(imports, "autoload.parameter");
  const functionDecls = named(defs, "function.declaration");
  const methodDecls = named(defs, "method.declaration");
  const classDecls = named(defs, "class.declaration");
  const callables = [...functionDecls, ...methodDecls];

  /** The first capture in `list` inside `span` whose innermost owner is `span`. */
  const ownIn = (span: Capture, list: readonly Capture[], owners: readonly Capture[]): Capture | undefined =>
    list.find((c) => contains(span, c) && innermost(owners, c) === span);
  const body = (span: Capture): Body => {
    const parameter = ownIn(span, parameters, callables);
    return { file: file.path, span, ...(parameter !== undefined && { parameter: variableName(parameter.text) }) };
  };
  const classOf = (c: Capture): string | undefined => {
    const owner = innermost(classDecls, c);
    return owner === undefined ? undefined : ownIn(owner, named(defs, "class.name"), classDecls)?.text;
  };

  const functions = functionDecls.flatMap((decl) => {
    const name = ownIn(decl, named(defs, "function.name"), callables)?.text;
    return name === undefined ? [] : [{ name, body: body(decl) }];
  });
  const methods = methodDecls.flatMap((decl) => {
    const name = ownIn(decl, named(defs, "method.name"), callables)?.text;
    const className = classOf(decl);
    return name === undefined || className === undefined ? [] : [{ className, name, body: body(decl) }];
  });
  const calls = named(imports, "autoload.register");
  const callbacks = named(imports, "autoload.callback");
  const registrations = calls.map((call): Registration => {
    const callback = ownIn(call, callbacks, calls);
    const enclosingClass = classOf(call);
    return { call, ...(callback !== undefined && { callback }), ...(enclosingClass !== undefined && { enclosingClass }) };
  });

  const names = owned(imports, "include.assign", "include.assigned");
  const values = owned(imports, "include.assign", "include.assign_value");
  const operators = owned(imports, "include.assign", "include.assign_operator");
  const assignments: Assignment[] = [];
  for (const [assign, name] of names) {
    const value = values.get(assign);
    if (value === undefined) continue;
    const operator = operators.get(assign)?.text;
    assignments.push({ name: variableName(name.text), value: value.text, start: assign.start, ...(operator !== undefined && { operator }) });
  }
  assignments.sort((a, b) => (before(a.start, b.start) ? -1 : before(b.start, a.start) ? 1 : 0));

  return { path: file.path, includes: readWrittenImports(file).filter(isInclude), assignments, functions, methods, registrations, parameters };
}

// ── Callbacks ───────────────────────────────────────────────────────────────

const NAME = String.raw`\\?[A-Za-z_]\w*(?:\\[A-Za-z_]\w*)*`;
/** `'load'`, `'Loader::load'`: the function, or the class and method. */
const QUOTED = new RegExp(String.raw`^(['"])(${NAME})(?:::([A-Za-z_]\w*))?\1$`);
/** A quoted class name. */
const QUOTED_CLASS = new RegExp(String.raw`^(['"])(${NAME})\1$`);
/** `Loader::class`. */
const CLASS_CONSTANT = new RegExp(String.raw`^(${NAME})\s*::\s*class$`, "i");
/** `array('C', 'm')`, `[$this, 'm']`: the class part as written and the method name. */
const ARRAY_CALLBACK = /^(?:array\s*\(|\[)\s*([^,]+?)\s*,\s*(['"])([A-Za-z_]\w*)\2\s*,?\s*[\])]$/is;
/** Class parts naming the class the callback is written in. */
const OWN_CLASS = new Set(["$this", "__class__", "self::class", "static::class"]);

/** A callback's text on one line, cut to 60 characters, for a notice. */
function abbreviate(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

/**
 * A callback's function, or class and method, when it is written as
 * literals; `enclosingClass` stands for `$this`, `__CLASS__`, `self::class`
 * and `static::class`. A `\\` in a quoted name is one `\`.
 */
function callbackTarget(text: string, enclosingClass: string | undefined): { readonly name: string; readonly className?: string } | undefined {
  const written = text.trim().replace(/\\\\/g, "\\");
  const quoted = QUOTED.exec(written);
  if (quoted) return quoted[3] === undefined ? { name: quoted[2]! } : { name: quoted[3], className: quoted[2]! };
  const pair = ARRAY_CALLBACK.exec(written);
  if (!pair) return undefined;
  const scope = pair[1]!;
  const className = OWN_CLASS.has(scope.replace(/\s+/g, "").toLowerCase())
    ? enclosingClass
    : (QUOTED_CLASS.exec(scope)?.[2] ?? CLASS_CONSTANT.exec(scope)?.[1]);
  return className === undefined ? undefined : { name: pair[3]!, className };
}

// ── Autoloaders ─────────────────────────────────────────────────────────────

/** Every autoloader of a project, and what each makes of a class name. */
export class PhpAutoloaders {
  private readonly loaders: Loader[] = [];
  private readonly noticeList: string[] = [];
  private readonly memo = new Map<string, readonly string[]>();

  constructor(
    sources: readonly PackSourceFile[],
    private readonly includes: PhpIncludes,
  ) {
    const files = [...sources].sort((a, b) => compare(a.path, b.path)).map(readFacts);
    const byFile = new Map(files.map((f) => [f.path, f]));
    const functions = new Map<string, Body[]>();
    const methods = new Map<string, Body[]>();
    const add = (map: Map<string, Body[]>, key: string, body: Body): void => {
      const list = map.get(key);
      if (list) list.push(body);
      else map.set(key, [body]);
    };
    for (const f of files) {
      for (const fn of f.functions) add(functions, shortName(fn.name), fn.body);
      for (const m of f.methods) add(methods, `${shortName(m.className)}::${m.name.toLowerCase()}`, m.body);
    }

    const seen = new Set<Capture>();
    /** `site` and `at` are where the autoloader is set up: its registration, or the `__autoload` declaration. */
    const loaderOf = (body: Body, label: string, site: string, at: SourcePosition): void => {
      if (seen.has(body.span)) return;
      seen.add(body.span);
      const facts = byFile.get(body.file)!;
      const loader: Loader = {
        body,
        includes: facts.includes.filter((i) => inside(body.span, i.position)),
        assignments: facts.assignments.filter((a) => inside(body.span, a.start)),
      };
      const dependent = loader.includes.filter((i) => {
        const [a, b] = PROBES.map((probe) => this.pathFor(loader, i, probe));
        return a !== undefined && b !== undefined && a !== b;
      });
      if (dependent.length === 0) this.notice(site, at, `autoloader ${label} does not build its path from literals and the class name; not followed`);
      else this.loaders.push({ ...loader, includes: dependent });
    };
    const declaredOnce = (map: ReadonlyMap<string, Body[]>, key: string, written: string, site: string, at: SourcePosition): Body | undefined => {
      const found = map.get(key) ?? [];
      if (found.length === 1) return found[0];
      const what = found.length === 0 ? "nothing the repository declares" : `${found.length} declarations`;
      this.notice(site, at, `spl_autoload_register(${written}) names ${what}; not followed`);
      return undefined;
    };

    for (const f of files) {
      for (const fn of f.functions) if (fn.name.toLowerCase() === "__autoload") loaderOf(fn.body, "__autoload", f.path, fn.body.span.start);
      for (const { call, callback, enclosingClass } of f.registrations) {
        if (callback === undefined) {
          this.notice(f.path, call.start, "spl_autoload_register() registers PHP's default spl_autoload; not followed");
          continue;
        }
        if (callback.nodeType === "anonymous_function" || callback.nodeType === "arrow_function") {
          const parameter = f.parameters.find((p) => contains(callback, p));
          const body = { file: f.path, span: callback, ...(parameter !== undefined && { parameter: variableName(parameter.text) }) };
          loaderOf(body, "closure", f.path, callback.start);
          continue;
        }
        const written = abbreviate(callback.text);
        const target = callbackTarget(callback.text, enclosingClass);
        if (target === undefined) {
          this.notice(f.path, call.start, `spl_autoload_register(${written}) is not a closure or a function or method named in the repository; not followed`);
          continue;
        }
        const key = target.className === undefined ? shortName(target.name) : `${shortName(target.className)}::${target.name.toLowerCase()}`;
        const body = declaredOnce(target.className === undefined ? functions : methods, key, written, f.path, call.start);
        if (body !== undefined) loaderOf(body, written, f.path, call.start);
      }
    }
  }

  private notice(file: string, at: SourcePosition, text: string): void {
    this.noticeList.push(`${file}:${at.line}: ${text}.`);
  }

  /** A variable's value at `at` in a loader's body when PHP loads `className`. */
  private valueAt(loader: Loader, name: string, at: SourcePosition, className: string): string | undefined {
    let value = name === loader.body.parameter ? className : undefined;
    for (const a of loader.assignments) {
      if (!before(a.start, at)) break;
      if (a.name !== name) continue;
      const assigned = this.includes.evaluate(a.value, loader.body.file, (n) => this.valueAt(loader, n, a.start, className));
      if (a.operator === undefined) value = assigned;
      else value = a.operator === ".=" && value !== undefined && assigned !== undefined ? value + assigned : undefined;
    }
    return value;
  }

  private pathFor(loader: Loader, include: WrittenImport, className: string): string | undefined {
    return this.includes.evaluate(include.specifier, loader.body.file, (n) => this.valueAt(loader, n, include.position, className));
  }

  /** The files the autoloaders would include for `className`, in the order their files set them up. */
  candidates(className: string): readonly string[] {
    const cached = this.memo.get(className);
    if (cached !== undefined) return cached;
    const out: string[] = [];
    for (const loader of this.loaders) {
      for (const include of loader.includes) {
        const outcome = this.includes.resolveValue(loader.body.file, this.pathFor(loader, include, className));
        if (outcome.kind === "internal" && !out.includes(outcome.target)) out.push(outcome.target);
      }
    }
    this.memo.set(className, out);
    return out;
  }

  /** One sentence per autoloader or registration not followed, by file, with its line. */
  notices(): readonly string[] {
    return this.noticeList;
  }
}
