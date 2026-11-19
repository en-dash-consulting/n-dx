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
 * - any other relative path is looked up under each include-path root, then
 *   in the including file's directory.
 * An absolute path outside the repository (`/usr/share/php/x.php`) resolves
 * to nothing. A target must be one of the pack's files.
 *
 * **Working directory**: PHP's is the directory of the entry script the
 * request started at, unknown here, so these are tried in order: the
 * including file's directory, each of its ancestors holding an `index.php`
 * (an entry script, as osCommerce's `catalog/` and `catalog/admin/`),
 * nearest first, then the docroot. The first that has the file wins.
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
 * relative to the working directory, tried as above. A root outside the repository is ignored with a notice.
 *
 * @module lang-php/php-includes
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PHP_DOCROOT_DIRECTORIES, trimTrailing, type WrittenImport } from "@n-dx/lang-kit";
import { contains, innermost, type Capture, type PackSourceFile } from "@n-dx/lang-runtime";
import { isOverlongLine, overlongLinesNotice } from "./php-line-cap.js";

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
  const trimmed = path.length > 1 ? trimTrailing(path, "/") : path;
  if (trimmed === REPO || trimmed.startsWith(OUTSIDE)) return OUTSIDE;
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return ".";
  if (slash === 0) return "/";
  return trimTrailing(trimmed.slice(0, slash), "/") || "/";
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

// ── Literal ends of a dynamic path ──────────────────────────────────────────

/** The index of the quote closing the string opened at `start`, or -1. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === quote) return i;
  }
  return -1;
}

/** The operands of a path expression's top-level `.` concatenation, as written; undefined when it does not scan. */
function concatenationOperands(text: string): string[] | undefined {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === "'" || c === '"') {
      i = stringEnd(text, i);
      if (i < 0) return undefined;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i <= 0) return undefined;
    } else if ((c === "/" && text[i + 1] === "/") || (c === "#" && text[i + 1] !== "[")) {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (depth === 0 && (text.startsWith("->", i) || text.startsWith("::", i))) i += 1;
    else if (depth === 0 && text.startsWith("?->", i)) i += 2;
    else if (depth === 0 && (/[?:|&^<>=!]/.test(c) || (!/[\w$\x80-￿]/.test(text[i - 1] ?? "") && /^(and|or|xor|instanceof)\b/i.test(text.slice(i))))) {
      // An operator binding more loosely than `.` (`?:`, `??`, `||`, a comparison, `and`): the operands of `.` are not the path's ends.
      return undefined;
    } else if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth < 0) return undefined;
    } else if (c === "." && depth === 0 && !(/[0-9]/.test(text[i - 1] ?? "") && /[0-9]/.test(text[i + 1] ?? ""))) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0) return undefined;
  out.push(text.slice(start).trim());
  return out.every((o) => o !== "") ? out : undefined;
}

/** Where the interpolation starting at `inner[at]` ends (exclusive); -1 when `at` starts none. */
function interpolationEnd(inner: string, at: number): number {
  const brace = inner[at] === "{" && inner[at + 1] === "$" ? at : inner[at] === "$" && inner[at + 1] === "{" ? at + 1 : -1;
  if (brace >= 0) {
    let depth = 0;
    for (let i = brace; i < inner.length; i += 1) {
      if (inner[i] === "'" || inner[i] === '"') i = Math.max(stringEnd(inner, i), i);
      else if (inner[i] === "{") depth += 1;
      else if (inner[i] === "}" && --depth === 0) return i + 1;
    }
    return inner.length;
  }
  const name = /^\$[A-Za-z_\x80-￿][\w\x80-￿]*/.exec(inner.slice(at));
  if (!name) return -1;
  let end = at + name[0].length;
  if (inner[end] === "[") {
    const close = inner.indexOf("]", end);
    end = close < 0 ? inner.length : close + 1;
  } else {
    const property = /^->[A-Za-z_\x80-￿][\w\x80-￿]*/.exec(inner.slice(end));
    if (property) end += property[0].length;
  }
  return end;
}

/**
 * The literal text before the first and after the last interpolation of a
 * double-quoted string operand (`"lang/$code.php"` gives `lang/` and `.php`);
 * undefined for any other operand.
 */
function interpolatedEnds(operand: string): { head: string; tail: string } | undefined {
  if (!operand.startsWith('"') || stringEnd(operand, 0) !== operand.length - 1) return undefined;
  const inner = operand.slice(1, -1);
  let first = -1;
  let last = -1;
  for (let i = 0; i < inner.length; ) {
    if (inner[i] === "\\") {
      i += 2;
      continue;
    }
    const end = interpolationEnd(inner, i);
    if (end < 0) {
      i += 1;
      continue;
    }
    if (first < 0) first = i;
    last = end;
    i = end;
  }
  if (first < 0) return undefined;
  const literal = (piece: string): string => evaluatePath(`"${piece}"`, "", () => undefined) ?? "";
  return { head: literal(inner.slice(0, first)), tail: literal(inner.slice(last)) };
}

/** The computable text a dynamic path starts and ends with. */
interface LiteralEnds {
  readonly prefix: string;
  readonly suffix: string;
}

/**
 * The computable prefix and suffix of a path expression that is not
 * computable as a whole: the leading and trailing operands of its `.`
 * concatenation that are, plus the literal ends of an interpolated string at
 * the boundary. Undefined when the whole path is computable or does not scan.
 */
function literalEnds(text: string, file: string, constant: ConstantLookup): LiteralEnds | undefined {
  const operands = concatenationOperands(text);
  if (operands === undefined) return undefined;
  const values = operands.map((o) => evaluatePath(o, file, constant));
  const first = values.indexOf(undefined);
  if (first < 0) return undefined;
  const last = values.lastIndexOf(undefined);
  return {
    prefix: values.slice(0, first).join("") + (interpolatedEnds(operands[first]!)?.head ?? ""),
    suffix: (interpolatedEnds(operands[last]!)?.tail ?? "") + values.slice(last + 1).join(""),
  };
}

/** How many candidate files a dynamic include lists; the rest are counted in `total`. */
export const MAX_INCLUDE_CANDIDATES = 50;

/** The files a dynamic include could load: at most {@link MAX_INCLUDE_CANDIDATES}, sorted, out of `total`. */
export interface PhpIncludeCandidates {
  readonly files: readonly string[];
  readonly total: number;
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

const isSpace = (c: string): boolean => /\s/.test(c);
const hasLineTerminator = (text: string): boolean => /[\n\r\u2028\u2029]/.test(text);

/** The length of the white space run at `from`. */
function spaceRun(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text[i]!)) i += 1;
  return i - from;
}

/** `text` from `from` starts with `word`, ASCII letters in either case when `anyCase`. */
const startsWithWord = (text: string, from: number, word: string, anyCase: boolean): boolean => {
  const found = text.slice(from, from + word.length);
  return anyCase ? found.length === word.length && found.toLowerCase() === word && /^[\x00-\x7f]*$/.test(found) : found === word;
};

/**
 * An `.htaccess` line's `php_value include_path <value>` value as written,
 * trimmed; both names in any letter case. White space alone after the name
 * (two characters or more) is a blank value, `" "`.
 */
function htaccessIncludePath(line: string): string | undefined {
  let i = spaceRun(line, 0);
  if (!startsWithWord(line, i, "php_value", true)) return undefined;
  i += "php_value".length;
  const gap = spaceRun(line, i);
  if (gap === 0) return undefined;
  i += gap;
  if (!startsWithWord(line, i, "include_path", true)) return undefined;
  i += "include_path".length;
  const rest = line.slice(i);
  if (rest === "" || !isSpace(rest[0]!)) return undefined;
  const value = rest.trim();
  if (value !== "") return hasLineTerminator(value) ? undefined : value;
  // White space alone: the separator is the first character, the value one of the rest that is not a line terminator.
  return /[^\n\r\u2028\u2029]/.test(rest.slice(1)) ? " " : undefined;
}

/** An ini line's `include_path = <value>` value as written: quotes dropped, else up to a `;` comment. */
function iniIncludePath(line: string): string | undefined {
  let i = spaceRun(line, 0);
  if (!startsWithWord(line, i, "include_path", false)) return undefined;
  i += "include_path".length;
  i += spaceRun(line, i);
  if (line[i] !== "=") return undefined;
  i += 1;
  i += spaceRun(line, i);
  const raw = line.slice(i);
  if (hasLineTerminator(raw)) return undefined;
  const value = raw.trim();
  // A quoted value ends at its closing quote; an unquoted one at a `;` comment (https://www.php.net/manual/en/function.parse-ini-file.php).
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const close = value.indexOf(quote, 1);
    if (close >= 0) return value.slice(1, close);
  }
  const comment = value.indexOf(";");
  return comment < 0 ? value : value.slice(0, comment).trimEnd();
}

/**
 * `include_path` settings in one configuration file's text, in order, and a
 * notice when lines longer than 64 KiB were skipped. Read by index scans, not
 * regexes: the text is the repository's.
 */
export function parsePhpIncludeConfig(
  file: string,
  kind: PhpIncludeConfigKind,
  text: string,
): { settings: PhpIncludeConfig[]; notices: string[] } {
  const settings: PhpIncludeConfig[] = [];
  let overlong = 0;
  for (const line of text.split(/\r?\n/)) {
    if (isOverlongLine(line)) {
      overlong += 1;
      continue;
    }
    if (kind === ".htaccess") {
      const value = htaccessIncludePath(line);
      if (value !== undefined) settings.push({ file, kind, value: unquote(value) });
      continue;
    }
    const value = iniIncludePath(line);
    if (value !== undefined) settings.push({ file, kind, value });
  }
  return { settings, notices: overlong > 0 ? [overlongLinesNotice(file, overlong, "include_path settings")] : [] };
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
    const parsed = parsePhpIncludeConfig(file, kind, text);
    configs.push(...parsed.settings);
    notices.push(...parsed.notices);
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
  /** `outside`: the path names a file outside the repository; `not-found`: no pack file is there. */
  | { readonly kind: "unresolved"; readonly reason: "outside" | "not-found" }
  /** The path is not computable; `candidates` when its literal ends match pack files. */
  | { readonly kind: "unresolved"; readonly reason: "dynamic"; readonly candidates?: PhpIncludeCandidates };

const INCLUDE_FORMS = new Set(["include", "include_once", "require", "require_once"]);

/** Whether a written import is an include rather than a `use`. */
export const isInclude = (w: WrittenImport): boolean => w.form !== undefined && INCLUDE_FORMS.has(w.form);

/** Every include of a project, resolved against its files, constants and include-path roots. */
export class PhpIncludes {
  private readonly files: ReadonlySet<string>;
  private readonly sortedFiles: readonly string[];
  private readonly docroot: string;
  /** Directories holding an `index.php`: entry-script directories, candidates for the working directory. */
  private readonly entryDirectories = new Set<string>();
  private readonly workingDirectoryCache = new Map<string, readonly string[]>();
  private readonly constants = new Map<string, ConstantDefinition[]>();
  private readonly constantValues = new Map<string, string | undefined>();
  private readonly evaluating = new Set<string>();
  private readonly setterRoots: Root[] = [];
  private readonly configs: readonly PhpIncludeConfig[];
  private readonly configRoots = new Map<PhpIncludeConfig, Root[]>();
  private readonly outsideRoots = new Set<string>();

  constructor(sources: readonly PackSourceFile[], files: ReadonlySet<string>, configs: readonly PhpIncludeConfig[]) {
    this.files = files;
    this.sortedFiles = [...files].sort(compare);
    this.docroot = PHP_DOCROOT_DIRECTORIES.find((d) => files.has(`${d}/index.php`)) ?? "";
    for (const f of files) if (f === "index.php" || f.endsWith("/index.php")) this.entryDirectories.add(dirOf(f));
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

  /**
   * Where PHP's working directory may be for an include in `file`, in search
   * order: its directory, its ancestors holding an `index.php` nearest first,
   * then the docroot.
   */
  private workingDirectories(file: string): readonly string[] {
    const here = dirOf(file);
    const cached = this.workingDirectoryCache.get(here);
    if (cached !== undefined) return cached;
    const dirs = [here];
    for (let dir = here; dir !== ""; ) {
      dir = dirOf(dir);
      if (this.entryDirectories.has(dir)) dirs.push(dir);
    }
    if (!dirs.includes(this.docroot)) dirs.push(this.docroot);
    this.workingDirectoryCache.set(here, dirs);
    return dirs;
  }

  /** The first candidate that is a pack file. */
  private first(candidates: Array<string | undefined>): string | undefined {
    return candidates.find((c): c is string => c !== undefined && this.files.has(c));
  }

  /** The value of a path expression written in `file`, with the repository's constants and `variable`; undefined when not computable. */
  evaluate(text: string, file: string, variable?: VariableLookup): string | undefined {
    return evaluatePath(text, file, this.constant, variable);
  }

  /** What an include written in `file` resolves to; a dynamic one carries its candidates. */
  resolve(file: string, include: WrittenImport): PhpIncludeOutcome {
    const outcome = this.resolveValue(file, this.evaluate(include.specifier, file));
    if (outcome.kind !== "unresolved" || outcome.reason !== "dynamic") return outcome;
    const candidates = this.candidates(file, include.specifier);
    return candidates === undefined ? outcome : { ...outcome, candidates };
  }

  /**
   * The pack files a dynamic include written in `file` could load: those
   * that start with its computable prefix, looked up as {@link resolveValue}
   * would look up a path (anchored, `./`, or under each include-path root and
   * then the including directory), and end with its computable suffix.
   * Without a prefix the whole repository is searched, but only for a suffix
   * holding a `/` (`/index.php`); a bare extension constrains nothing. There
   * a leading `/` ends the unknown prefix (`DRUPAL_ROOT . '/includes/x.inc'`),
   * so a file at the repository root matches it too.
   * Undefined when nothing matches.
   */
  candidates(file: string, specifier: string): PhpIncludeCandidates | undefined {
    const ends = literalEnds(specifier, file, this.constant);
    if (ends === undefined) return undefined;
    const { suffix } = ends;
    const found = new Set<string>();
    for (const start of this.candidateStarts(file, ends.prefix)) {
      if (start === "") {
        if (!suffix.includes("/")) continue;
        for (const f of this.files) if (`/${f}`.endsWith(suffix)) found.add(f);
        continue;
      }
      for (const f of this.startingWith(start)) {
        if (f.length >= start.length + suffix.length && f.endsWith(suffix)) found.add(f);
      }
    }
    if (found.size === 0) return undefined;
    return { files: [...found].sort(compare).slice(0, MAX_INCLUDE_CANDIDATES), total: found.size };
  }

  /** The repository-relative text a candidate starts with, for each place a path with this prefix is looked up. */
  private candidateStarts(file: string, prefix: string): string[] {
    if (prefix === "") return [""];
    const located = locate(prefix);
    if (located === undefined || located.kind === "outside") return [];
    const here = dirOf(file);
    let path: string;
    let bases: Array<string | undefined>;
    if (located.kind === "repo") {
      path = prefix.slice(REPO.length);
      bases = [""];
    } else {
      path = located.path;
      const working = this.workingDirectories(file);
      bases = /^\.\.?(\/|$)/.test(path)
        ? [...working]
        : [
            ...this.rootsFor(file).flatMap((root) =>
              root.kind === "repo" ? [root.path] : working.map((dir) => normalize(dir, root.path)),
            ),
            here,
          ];
    }
    const slash = path.lastIndexOf("/");
    const name = path.slice(slash + 1);
    const starts: string[] = [];
    for (const base of bases) {
      const dir = base === undefined ? undefined : normalize(base, path.slice(0, slash + 1));
      if (dir === undefined) continue;
      const start = dir === "" ? name : `${dir}/${name}`;
      if (!starts.includes(start)) starts.push(start);
    }
    return starts;
  }

  /** The pack files starting with `start`, in order. */
  private startingWith(start: string): readonly string[] {
    if (start === "") return this.sortedFiles;
    let low = 0;
    let high = this.sortedFiles.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.sortedFiles[mid]! < start) low = mid + 1;
      else high = mid;
    }
    const out: string[] = [];
    for (let i = low; i < this.sortedFiles.length && this.sortedFiles[i]!.startsWith(start); i += 1) out.push(this.sortedFiles[i]!);
    return out;
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
    else if (/^\.\.?(\/|$)/.test(located.path)) {
      outcome = found(this.first(this.workingDirectories(file).map((dir) => normalize(dir, located.path))), "relative");
    } else {
      const working = this.workingDirectories(file);
      const underRoots = this.rootsFor(file).flatMap((root) =>
        root.kind === "repo" ? [normalize(root.path, located.path)] : working.map((dir) => normalize(dir, root.path, located.path)),
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
