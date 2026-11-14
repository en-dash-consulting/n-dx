/**
 * PHP include resolution: `include`, `require` and their `_once` forms whose
 * path is computable from literals become edges to project files. PHP is
 * never run; php.ini, `.user.ini` and `.htaccess` are read as text.
 *
 * **Computable paths.** A path expression (`php-imports.ts` gives it as
 * written) is computable when it is built only from string literals (a
 * double-quoted one without interpolation), `.` concatenation, parentheses,
 * `__DIR__`, `__FILE__`, `dirname(x)` and `dirname(x, n)`,
 * `DIRECTORY_SEPARATOR`, and constants the repository defines once with such
 * a value (`define('ROOT', dirname(__FILE__))`, `const ROOT = __DIR__;` outside
 * a class); a constant defined with two different values is not computable.
 * Anything else (a variable, a call, a constant PHP or an extension defines)
 * is not, and gives no edge.
 *
 * **Search order**, as PHP's `include` does
 * (https://www.php.net/manual/en/function.include.php):
 * - a path built from `__DIR__`, `__FILE__` or a constant holding one is the
 *   repository file it names;
 * - a path starting with `./` or `../` is relative to the working directory;
 *   PHP's working directory is unknown here, so the including file's
 *   directory is tried first, then the docroot;
 * - any other relative path is looked up under each include-path root, then
 *   in the including file's directory.
 * An absolute path outside the repository (`/usr/share/php/x.php`) resolves
 * to nothing. A target must be one of the pack's files.
 *
 * **Docroot**: the first of lang-kit's {@link PHP_DOCROOT_DIRECTORIES} holding
 * an `index.php`, else the repository root.
 *
 * **Include-path roots**, in this order, without duplicates:
 * 1. literal `set_include_path(…)` and `ini_set('include_path', …)` anywhere
 *    in the repository (a `get_include_path()` part stands for the roots
 *    already known and is dropped; `PATH_SEPARATOR`, `:` and `;` separate
 *    roots), by file path then position;
 * 2. `include_path` of a `.user.ini` and `php_value include_path` of a
 *    `.htaccess` in the including file's directory or above, nearest first
 *    (https://www.php.net/manual/en/configuration.file.per-user.php,
 *    https://www.php.net/manual/en/configuration.changes.php);
 * 3. `include_path` of any `php.ini` in the repository, by path.
 * With none, PHP's default `.` applies. A relative root (`.`, `lib`) is
 * relative to the working directory: the including file's directory, then
 * the docroot. A root outside the repository is ignored with a notice.
 *
 * @module lang-php/php-includes
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PHP_DOCROOT_DIRECTORIES, type WrittenImport } from "@n-dx/lang-kit";
import { contains, innermost, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";

// ── Values ──────────────────────────────────────────────────────────────────

/** Stands for the repository root in a computed path: `__FILE__` is `REPO + "/" + path`. */
const REPO = "\u0000";
/** Stands for a directory above the repository root (`dirname` of {@link REPO}). */
const OUTSIDE = "\u0001";
/** `get_include_path()`. */
const CURRENT_INCLUDE_PATH = "\u0002";
/** `PATH_SEPARATOR`. */
const PATH_SEPARATOR = "\u0003";

const dirOf = (path: string): string => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** PHP's `dirname()` on a computed path. */
function dirname(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (trimmed === REPO || trimmed.startsWith(OUTSIDE)) return OUTSIDE;
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return ".";
  if (slash === 0) return "/";
  return trimmed.slice(0, slash).replace(/\/+$/, "") || "/";
}

/** `base/rel` with `.` and `..` folded; undefined when it climbs above the repository. */
function normalize(...parts: string[]): string | undefined {
  const out: string[] = [];
  for (const segment of parts.join("/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(segment);
  }
  return out.join("/");
}

/** Where a computed path points. */
type Located =
  | { readonly kind: "repo"; readonly path: string }
  | { readonly kind: "relative"; readonly path: string }
  | { readonly kind: "outside" };

function locate(value: string): Located | undefined {
  if (value.includes(CURRENT_INCLUDE_PATH) || value.includes(PATH_SEPARATOR)) return undefined;
  if (value.startsWith(REPO)) {
    const rest = value.slice(REPO.length);
    if (rest !== "" && !rest.startsWith("/")) return { kind: "outside" }; // `__DIR__ . 'x'` at the root names a sibling of the repository
    const path = normalize(rest);
    return path === undefined ? { kind: "outside" } : { kind: "repo", path };
  }
  if (value.startsWith(OUTSIDE) || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) return { kind: "outside" };
  return { kind: "relative", path: value };
}

// ── Path expressions ────────────────────────────────────────────────────────

/** Looks a constant up; undefined when it is not computable. */
type ConstantLookup = (name: string) => string | undefined;

/** Looks a variable up by name, without its `$`; undefined when it is not computable. */
export type VariableLookup = (name: string) => string | undefined;

const NO_VARIABLES: VariableLookup = () => undefined;

/** `str_replace()` with string or array search and replace (https://www.php.net/manual/en/function.str-replace.php). */
function strReplace(search: readonly string[], replace: readonly string[] | string, subject: string): string {
  let out = subject;
  search.forEach((s, i) => {
    if (s === "") return;
    out = out.split(s).join(typeof replace === "string" ? replace : (replace[i] ?? ""));
  });
  return out;
}

/** `strtr($s, $from, $to)`: each character of `from` becomes the one at its place in `to` (https://www.php.net/manual/en/function.strtr.php). */
function strtr(subject: string, from: string, to: string): string {
  const length = Math.min(from.length, to.length);
  let out = "";
  for (const c of subject) {
    const at = from.lastIndexOf(c);
    out += at >= 0 && at < length ? to[at] : c;
  }
  return out;
}

/** Thrown inside {@link evaluatePath} when the expression is not computable. */
class NotComputable extends Error {}

/** One escape in a double-quoted string (https://www.php.net/manual/en/language.types.string.php). */
const DOUBLE_ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r", v: "\v", e: "\u001b", f: "\f", "\\": "\\", $: "$", '"': '"' };

/**
 * The value of a PHP path expression written in `file`, or undefined when it
 * is not computable. `__FILE__` is the {@link REPO}-rooted path of `file`.
 * A variable is computable only through `variable`; so are `str_replace()`,
 * `strtr()` with three arguments, `strtolower()`, `strtoupper()` and
 * `ltrim()`, `rtrim()` and `trim()` with a character list, which an autoloader
 * applies to its class name.
 */
function evaluatePath(text: string, file: string, constant: ConstantLookup, variable: VariableLookup = NO_VARIABLES): string | undefined {
  let at = 0;

  const skip = (): void => {
    for (;;) {
      const ws = /^\s+/.exec(text.slice(at));
      if (ws) at += ws[0].length;
      else if (text.startsWith("/*", at)) {
        const end = text.indexOf("*/", at + 2);
        if (end < 0) throw new NotComputable();
        at = end + 2;
      } else if (text.startsWith("//", at) || (text[at] === "#" && text[at + 1] !== "[")) {
        const end = text.indexOf("\n", at);
        at = end < 0 ? text.length : end + 1;
      } else return;
    }
  };

  const eat = (token: string): boolean => {
    skip();
    if (!text.startsWith(token, at)) return false;
    at += token.length;
    return true;
  };

  const single = (): string => {
    let out = "";
    for (at += 1; at < text.length; at += 1) {
      const c = text[at]!;
      if (c === "'") {
        at += 1;
        return out;
      }
      if (c === "\\" && (text[at + 1] === "'" || text[at + 1] === "\\")) out += text[++at];
      else out += c;
    }
    throw new NotComputable();
  };

  const double = (): string => {
    let out = "";
    for (at += 1; at < text.length; at += 1) {
      const c = text[at]!;
      if (c === '"') {
        at += 1;
        return out;
      }
      if (c === "$" && /[A-Za-z_\x80-\uffff{]/.test(text[at + 1] ?? "")) throw new NotComputable(); // interpolation
      if (c === "{" && text[at + 1] === "$") throw new NotComputable();
      if (c === "\\" && text[at + 1] !== undefined && text[at + 1]! in DOUBLE_ESCAPES) out += DOUBLE_ESCAPES[text[++at]!];
      else if (c === "\\" && /[0-7xu]/.test(text[at + 1] ?? "")) throw new NotComputable(); // octal, hex and Unicode escapes never name a path
      else out += c;
    }
    throw new NotComputable();
  };

  const integer = (): number => {
    skip();
    const digits = /^[0-9]+/.exec(text.slice(at));
    if (!digits) throw new NotComputable();
    at += digits[0].length;
    return Number(digits[0]);
  };

  /** The arguments of a call whose `(` was eaten, through its `)`. */
  const args = (): string[] => {
    const out: string[] = [];
    if (eat(")")) return out;
    do out.push(expression());
    while (eat(","));
    if (!eat(")")) throw new NotComputable();
    return out;
  };

  /** A string, or an `array(\u2026)` or `[\u2026]` of strings: `str_replace()`'s search and replace. */
  const list = (): string[] | string => {
    skip();
    if (eat("[")) {
      const items: string[] = [];
      if (!eat("]")) {
        do items.push(expression());
        while (eat(","));
        if (!eat("]")) throw new NotComputable();
      }
      return items;
    }
    if (/^array\s*\(/i.test(text.slice(at))) {
      at = text.indexOf("(", at) + 1;
      return args();
    }
    return expression();
  };

  /** A character list for `trim()`; a `..` range is not followed. */
  const characters = (value: string): string => {
    if (value.includes("..")) throw new NotComputable();
    return value;
  };

  const trimmed = (value: string, chars: string, start: boolean, end: boolean): string => {
    let from = 0;
    let to = value.length;
    while (start && from < to && chars.includes(value[from]!)) from += 1;
    while (end && to > from && chars.includes(value[to - 1]!)) to -= 1;
    return value.slice(from, to);
  };

  const call = (lower: string): string => {
    if (lower === "dirname") {
      let value = dirname(expression());
      if (eat(",")) {
        const levels = integer();
        if (levels < 1) throw new NotComputable(); // PHP throws a ValueError
        for (let level = 1; level < levels; level += 1) value = dirname(value);
      }
      if (!eat(")")) throw new NotComputable();
      return value;
    }
    if (lower === "get_include_path" && eat(")")) return CURRENT_INCLUDE_PATH;
    if (lower === "str_replace") {
      const search = list();
      if (!eat(",")) throw new NotComputable();
      const replace = list();
      if (!eat(",")) throw new NotComputable();
      const subject = expression();
      if (!eat(")")) throw new NotComputable(); // a fourth argument, the count, is a variable
      if (typeof replace !== "string" && typeof search === "string") throw new NotComputable(); // PHP throws a TypeError
      return strReplace(typeof search === "string" ? [search] : search, replace, subject);
    }
    const values = args();
    const [first, second, third] = values;
    if (lower === "strtolower" && values.length === 1) return first!.toLowerCase();
    if (lower === "strtoupper" && values.length === 1) return first!.toUpperCase();
    if (lower === "strtr" && values.length === 3) return strtr(first!, second!, third!);
    if ((lower === "ltrim" || lower === "rtrim" || lower === "trim") && values.length === 2) {
      return trimmed(first!, characters(second!), lower !== "rtrim", lower !== "ltrim");
    }
    throw new NotComputable();
  };

  const term = (): string => {
    skip();
    const c = text[at];
    if (c === "'") return single();
    if (c === '"') return double();
    if (c === "(") {
      at += 1;
      const value = expression();
      if (!eat(")")) throw new NotComputable();
      return value;
    }
    const dollar = /^\$([A-Za-z_\x80-\uffff][\w\x80-\uffff]*)/.exec(text.slice(at));
    if (dollar) {
      at += dollar[0].length;
      const value = variable(dollar[1]!);
      if (value === undefined) throw new NotComputable();
      skip();
      if (/^(->|\?->|\[|::|\()/.test(text.slice(at))) throw new NotComputable(); // a property, element or call of the variable
      return value;
    }
    const word = /^\\?[A-Za-z_\x80-\uffff][\w\x80-\uffff]*/.exec(text.slice(at));
    if (!word) throw new NotComputable();
    at += word[0].length;
    const name = word[0].replace(/^\\/, "");
    const lower = name.toLowerCase();
    if (eat("(")) return call(lower);
    if (lower === "__dir__") return dirname(`${REPO}/${file}`);
    if (lower === "__file__") return `${REPO}/${file}`;
    if (name === "DIRECTORY_SEPARATOR") return "/";
    if (name === "PATH_SEPARATOR") return PATH_SEPARATOR;
    const value = constant(name);
    if (value === undefined) throw new NotComputable();
    return value;
  };

  const expression = (): string => {
    let value = term();
    while (eat(".")) value += term();
    return value;
  };

  try {
    const value = expression();
    skip();
    return at === text.length ? value : undefined;
  } catch (error) {
    if (error instanceof NotComputable) return undefined;
    throw error;
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

interface ConstantDefinition {
  readonly value: string;
  readonly file: string;
}


/** Each capture named `part` paired with the innermost `owner` capture holding it. */
export function owned(captures: readonly Capture[], owner: string, part: string): Map<Capture, Capture> {
  const owners = captures.filter((c) => c.name === owner);
  const out = new Map<Capture, Capture>();
  for (const c of captures) {
    if (c.name !== part) continue;
    const o = innermost(owners, c);
    if (o !== undefined && !out.has(o)) out.set(o, c);
  }
  return out;
}

/**
 * Global constants a file defines with `define('NAME', …)`, or with a
 * file-level `const NAME = …` outside a namespace (the query takes no class
 * constant).
 */
function constantsOf(file: PackSourceFile): Array<{ readonly name: string; readonly definition: ConstantDefinition }> {
  const captures = file.captures.imports ?? [];
  const namespaces = (file.captures.definitions ?? []).filter((c) => c.name === "namespace.declaration");
  // PHP allows no code outside a braced namespace once a file has one, so a namespace before the constant holds it.
  const inNamespace = (c: Capture): boolean =>
    namespaces.some((n) => n.start.line < c.start.line || (n.start.line === c.start.line && n.start.column < c.start.column));
  const out: Array<{ name: string; definition: ConstantDefinition }> = [];
  const names = owned(captures, "include.define", "include.define_name");
  const values = owned(captures, "include.define", "include.define_value");
  for (const [call, name] of names) {
    const value = values.get(call);
    const literal = /^(['"])([A-Za-z_][\w]*)\1$/.exec(name.text);
    if (value !== undefined && literal) out.push({ name: literal[2]!, definition: { value: value.text, file: file.path } });
  }
  const constNames = owned(captures, "include.const", "include.const_name");
  const constValues = owned(captures, "include.const", "include.const_value");
  for (const [element, name] of constNames) {
    const value = constValues.get(element);
    if (value !== undefined && !inNamespace(element)) out.push({ name: name.text, definition: { value: value.text, file: file.path } });
  }
  return out;
}

// ── Include-path configuration ──────────────────────────────────────────────

/** Where an `include_path` setting is read from. */
export type PhpIncludeConfigKind = "php.ini" | ".user.ini" | ".htaccess";

/** One `include_path` setting found in a configuration file, value as written without quotes. */
export interface PhpIncludeConfig {
  /** Project-relative path of the configuration file. */
  readonly file: string;
  readonly kind: PhpIncludeConfigKind;
  readonly value: string;
}

const CONFIG_KINDS: ReadonlyMap<string, PhpIncludeConfigKind> = new Map([
  ["php.ini", "php.ini"],
  [".user.ini", ".user.ini"],
  [".htaccess", ".htaccess"],
]);

const unquote = (value: string): string => {
  const v = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(v);
  return quoted ? quoted[2]! : v;
};

/** `include_path` settings in one configuration file's text, in order. */
export function parsePhpIncludeConfig(file: string, kind: PhpIncludeConfigKind, text: string): PhpIncludeConfig[] {
  const out: PhpIncludeConfig[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (kind === ".htaccess") {
      // Apache directive names are case-insensitive; the PHP setting's name is not.
      const m = /^\s*php_value\s+include_path\s+(.+?)\s*$/i.exec(line);
      if (m) out.push({ file, kind, value: unquote(m[1]!) });
      continue;
    }
    const m = /^\s*include_path\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[1]!.trim();
    // An unquoted value ends at a `;` comment (https://www.php.net/manual/en/function.parse-ini-file.php).
    const quoted = /^(["'])(.*?)\1/.exec(raw);
    const value = quoted ? quoted[2]! : raw.replace(/\s*;.*$/, "");
    out.push({ file, kind, value });
  }
  return out;
}

/** The `include_path` settings of every php.ini, `.user.ini` and `.htaccess` among `listed` (project-relative), by path. */
export async function readPhpIncludeConfigs(projectDir: string, listed: readonly string[]): Promise<{ configs: PhpIncludeConfig[]; notices: string[] }> {
  const configs: PhpIncludeConfig[] = [];
  const notices: string[] = [];
  for (const file of [...listed].sort(compare)) {
    const kind = CONFIG_KINDS.get(file.slice(file.lastIndexOf("/") + 1));
    if (kind === undefined) continue;
    let text: string;
    try {
      text = await readFile(join(projectDir, file), "utf8");
    } catch (error) {
      notices.push(`could not read ${file} (${(error as NodeJS.ErrnoException).code ?? "error"}); its include_path is not used.`);
      continue;
    }
    configs.push(...parsePhpIncludeConfig(file, kind, text));
  }
  return { configs, notices };
}

// ── Roots ───────────────────────────────────────────────────────────────────

/** One include-path root: a repository directory, or a directory relative to the working directory. */
type Root = { readonly kind: "repo" | "relative"; readonly path: string };

/** An include path's roots; a part outside the repository is reported to `outside`. */
function rootsOf(value: string, outside: (part: string) => void): Root[] {
  const parts = value.split(new RegExp(`[${PATH_SEPARATOR}:;]`));
  // `C:\php\pear` was split at its drive colon: join it back.
  for (let i = 0; i + 1 < parts.length; i += 1) {
    if (/^[A-Za-z]$/.test(parts[i]!) && /^[\\/]/.test(parts[i + 1]!)) parts.splice(i, 2, `${parts[i]}:${parts[i + 1]}`);
  }
  const roots: Root[] = [];
  for (const part of parts) {
    if (part === "" || part.includes(CURRENT_INCLUDE_PATH)) continue;
    const located = locate(part);
    if (located === undefined) continue;
    if (located.kind === "outside") outside(part.replace(REPO, "<repository>").replace(OUTSIDE, "<above the repository>"));
    else roots.push(located);
  }
  return roots;
}

const sameRoot = (a: Root, b: Root): boolean => a.kind === b.kind && a.path === b.path;

// ── Resolution ──────────────────────────────────────────────────────────────

/** How a resolved include found its file. */
export type PhpIncludeResolution = "anchored" | "relative" | "include-path" | "including-directory";

/** What one include resolved to. */
export type PhpIncludeOutcome =
  | { readonly kind: "internal"; readonly target: string; readonly via: PhpIncludeResolution }
  /** `dynamic`: the path is not computable; `outside`: it names a file outside the repository; `not-found`: no pack file is there. */
  | { readonly kind: "unresolved"; readonly reason: "dynamic" | "outside" | "not-found" };

const INCLUDE_FORMS = new Set(["include", "include_once", "require", "require_once"]);

/** Whether a written import is an include rather than a `use`. */
export const isInclude = (w: WrittenImport): boolean => w.form !== undefined && INCLUDE_FORMS.has(w.form);

/** Every include of a project, resolved against its files, constants and include-path roots. */
export class PhpIncludes {
  private readonly files: ReadonlySet<string>;
  private readonly docroot: string;
  private readonly constants = new Map<string, ConstantDefinition[]>();
  private readonly constantValues = new Map<string, string | undefined>();
  private readonly evaluating = new Set<string>();
  private readonly setterRoots: Root[] = [];
  private readonly configs: readonly PhpIncludeConfig[];
  private readonly configRoots = new Map<PhpIncludeConfig, Root[]>();
  private readonly outsideRoots = new Set<string>();

  constructor(sources: readonly PackSourceFile[], files: ReadonlySet<string>, configs: readonly PhpIncludeConfig[]) {
    this.files = files;
    this.docroot = PHP_DOCROOT_DIRECTORIES.find((d) => files.has(`${d}/index.php`)) ?? "";
    const ordered = [...sources].sort((a, b) => compare(a.path, b.path));
    for (const file of ordered) {
      for (const { name, definition } of constantsOf(file)) {
        const list = this.constants.get(name);
        if (list) list.push(definition);
        else this.constants.set(name, [definition]);
      }
    }
    for (const file of ordered) {
      for (const value of this.includePathSettings(file)) {
        const computed = evaluatePath(value, file.path, this.constant);
        if (computed === undefined) continue;
        for (const root of rootsOf(computed, (part) => this.outsideRoots.add(`"${part}" (set in ${file.path})`))) this.addRoot(this.setterRoots, root);
      }
    }
    this.configs = configs;
    for (const config of configs) {
      const roots: Root[] = [];
      for (const root of rootsOf(config.value, (part) => this.outsideRoots.add(`"${part}" (${config.file})`))) this.addRoot(roots, root);
      this.configRoots.set(config, roots);
    }
  }

  /** The path expressions a file passes to `set_include_path()` and `ini_set('include_path', …)`. */
  private includePathSettings(file: PackSourceFile): string[] {
    const captures = file.captures.imports ?? [];
    const out = [...owned(captures, "include.set", "include.set_path").values()].map((c) => c.text);
    const keys = owned(captures, "include.ini", "include.ini_key");
    const values = owned(captures, "include.ini", "include.ini_value");
    for (const [call, key] of keys) {
      const value = values.get(call);
      if (value !== undefined && /^(['"])include_path\1$/.test(key.text)) out.push(value.text);
    }
    return out;
  }

  private addRoot(roots: Root[], root: Root): void {
    if (!roots.some((r) => sameRoot(r, root))) roots.push(root);
  }

  /** A constant's value when every definition in the repository computes to the same one. */
  private readonly constant: ConstantLookup = (name) => {
    if (this.constantValues.has(name)) return this.constantValues.get(name);
    const definitions = this.constants.get(name);
    if (definitions === undefined || this.evaluating.has(name)) return undefined;
    this.evaluating.add(name);
    const values = new Set(definitions.map((d) => evaluatePath(d.value, d.file, this.constant)));
    this.evaluating.delete(name);
    const value = values.size === 1 ? [...values][0] : undefined;
    this.constantValues.set(name, value);
    return value;
  };

  /** Include-path roots for a file, in search order; PHP's default `.` when nothing sets one. */
  private rootsFor(file: string): Root[] {
    const roots: Root[] = [...this.setterRoots];
    const scoped = this.configs
      .filter((c) => c.kind !== "php.ini" && (dirOf(c.file) === "" || file.startsWith(`${dirOf(c.file)}/`)))
      .sort((a, b) => b.file.split("/").length - a.file.split("/").length || compare(a.file, b.file));
    const global = this.configs.filter((c) => c.kind === "php.ini");
    for (const config of [...scoped, ...global]) for (const root of this.configRoots.get(config) ?? []) this.addRoot(roots, root);
    return roots.length > 0 ? roots : [{ kind: "relative", path: "." }];
  }

  /** The first candidate that is a pack file. */
  private first(candidates: Array<string | undefined>): string | undefined {
    return candidates.find((c): c is string => c !== undefined && this.files.has(c));
  }

  /** The value of a path expression written in `file`, with the repository's constants and `variable`; undefined when not computable. */
  evaluate(text: string, file: string, variable?: VariableLookup): string | undefined {
    return evaluatePath(text, file, this.constant, variable);
  }

  /** What an include written in `file` resolves to. */
  resolve(file: string, include: WrittenImport): PhpIncludeOutcome {
    return this.resolveValue(file, this.evaluate(include.specifier, file));
  }

  /** What an include in `file` of a path with value `value` (from {@link evaluate}) resolves to. */
  resolveValue(file: string, value: string | undefined): PhpIncludeOutcome {
    const located = value === undefined ? undefined : locate(value);
    if (located === undefined) return { kind: "unresolved", reason: "dynamic" };
    if (located.kind === "outside") return { kind: "unresolved", reason: "outside" };
    const here = dirOf(file);
    const found = (target: string | undefined, via: PhpIncludeResolution): PhpIncludeOutcome | undefined =>
      target === undefined ? undefined : { kind: "internal", target, via };
    let outcome: PhpIncludeOutcome | undefined;
    if (located.kind === "repo") outcome = found(this.first([located.path]), "anchored");
    else if (/^\.\.?(\/|$)/.test(located.path)) outcome = found(this.first([normalize(here, located.path), normalize(this.docroot, located.path)]), "relative");
    else {
      const underRoots = this.rootsFor(file).flatMap((root) =>
        root.kind === "repo"
          ? [normalize(root.path, located.path)]
          : [normalize(here, root.path, located.path), normalize(this.docroot, root.path, located.path)],
      );
      outcome = found(this.first(underRoots), "include-path") ?? found(this.first([normalize(here, located.path)]), "including-directory");
    }
    return outcome ?? { kind: "unresolved", reason: "not-found" };
  }

  /** One sentence per include-path root ignored for lying outside the repository. */
  notices(): string[] {
    return [...this.outsideRoots].sort(compare).map((root) => `include path root ${root} is outside the repository; ignored.`);
  }
}
