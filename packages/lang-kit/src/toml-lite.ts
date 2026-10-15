/**
 * A small TOML reader for Gradle version catalogs (`gradle/libs.versions.toml`)
 * and Python's `pyproject.toml`. Understands tables, arrays of tables, dotted
 * keys, basic and literal strings (also multi-line), arrays (also across
 * lines), inline tables, booleans and numbers. Dates are rejected rather than
 * misread. No dependency.
 *
 * {@link parseTomlLocated} also reports the line each value starts on, so a
 * reader can cite where a fact came from.
 *
 * @module lang-kit/toml-lite
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export class TomlSyntaxError extends Error {
  constructor(message: string, readonly line: number) {
    super(`${message} (line ${line})`);
    this.name = "TomlSyntaxError";
  }
}

/** A path into a parsed document: table keys, and array indexes (an array of tables is an array). */
export type TomlPath = readonly (string | number)[];

export interface LocatedToml {
  readonly table: TomlTable;
  /** The 1-based line the value at `path` starts on; undefined when there is no such value. */
  lineOf(path: TomlPath): number | undefined;
}

const ESCAPES: Readonly<Record<string, string>> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
const BARE_KEY = /[A-Za-z0-9_-]/;

export function parseToml(src: string): TomlTable {
  return new Reader(src).document();
}

/** {@link parseToml}, plus the line each value (and each array item) starts on. */
export function parseTomlLocated(src: string): LocatedToml {
  const lines = new Map<string, number>();
  const table = new Reader(src, lines).document();
  return { table, lineOf: (path) => lines.get(JSON.stringify(path)) };
}

/** TOML allows `_` between digits; anything else is left for `Number` to reject. */
function numberText(word: string): string {
  return /^[+-]?\d+(?:_\d+)*(?:\.\d+(?:_\d+)*)?(?:[eE][+-]?\d+(?:_\d+)*)?$/.test(word) ? word.replace(/_/g, "") : word;
}

function setOwn(table: TomlTable, key: string, value: TomlValue): void {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
}

class Reader {
  private i = 0;
  private line = 1;
  /** Arrays made by `[[…]]` headers; a static array (`x = [ … ]`) cannot be extended by one. */
  private readonly tableArrays = new WeakSet<TomlValue[]>();

  /** `lines`, when given, collects the start line of every value keyed by its JSON-encoded path. */
  constructor(
    private readonly src: string,
    private readonly lines?: Map<string, number>,
  ) {}

  document(): TomlTable {
    const root: TomlTable = {};
    let current = root;
    let currentPath: (string | number)[] = [];
    for (;;) {
      this.skipBlank();
      if (this.eof()) return root;
      if (this.peek() === "[") {
        const arrayOfTables = this.src[this.i + 1] === "[";
        this.i += arrayOfTables ? 2 : 1;
        const keys = this.keyPath("]");
        this.expect("]");
        if (arrayOfTables) this.expect("]");
        ({ table: current, path: currentPath } = arrayOfTables ? this.appendTable(root, keys) : this.descend(root, keys));
      } else {
        const path = this.keyPath("=");
        this.expect("=");
        this.assign(current, currentPath, path);
      }
      this.endOfLine();
    }
  }

  // ── Values ─────────────────────────────────────────────────────────────

  private value(path: (string | number)[]): TomlValue {
    this.skipSpaces();
    this.lines?.set(JSON.stringify(path), this.line);
    const c = this.peek();
    if (c === '"' || c === "'") return this.string();
    if (c === "[") return this.array(path);
    if (c === "{") return this.inlineTable(path);
    const start = this.i;
    while (!this.eof() && !",]}#\n\r \t".includes(this.peek())) this.i++;
    const word = this.src.slice(start, this.i);
    if (word === "true") return true;
    if (word === "false") return false;
    const n = Number(numberText(word));
    if (word !== "" && Number.isFinite(n) && word.split("-").length < 3) return n;
    return this.fail(`unsupported value "${word}"`);
  }

  private string(): string {
    const quote = this.src[this.i];
    if (this.src.startsWith(quote.repeat(3), this.i)) return this.multiLineString(quote);
    this.i++;
    let out = "";
    for (;;) {
      if (this.eof() || this.peek() === "\n") this.fail("unterminated string");
      const c = this.src[this.i++];
      if (c === quote) return out;
      if (c !== "\\" || quote === "'") {
        out += c;
        continue;
      }
      out += this.escape();
    }
  }

  /** `"""…"""` or `'''…'''`: a newline right after the opener is dropped; up to two quotes may precede the closer. */
  private multiLineString(quote: string): string {
    const fence = quote.repeat(3);
    this.i += 3;
    if (this.peek() === "\r" && this.src[this.i + 1] === "\n") this.i++;
    if (this.peek() === "\n") this.newline();
    let out = "";
    for (;;) {
      if (this.eof()) this.fail("unterminated multi-line string");
      if (this.src.startsWith(fence, this.i)) {
        let extra = 0;
        while (extra < 2 && this.src[this.i + 3 + extra] === quote) extra++;
        this.i += 3 + extra;
        return out + quote.repeat(extra);
      }
      const c = this.src[this.i];
      if (c === "\n") {
        this.newline();
        out += c;
      } else if (c === "\\" && quote === '"') {
        this.i++;
        if (this.lineEndingBackslash()) continue;
        out += this.escape();
      } else {
        out += c;
        this.i++;
      }
    }
  }

  /** After a backslash in a multi-line basic string: if the rest of the line is blank, trim through the next non-blank character. */
  private lineEndingBackslash(): boolean {
    let j = this.i;
    while (this.src[j] === " " || this.src[j] === "\t") j++;
    if (this.src[j] === "\r") j++;
    if (this.src[j] !== "\n") return false;
    this.i = j;
    for (;;) {
      const c = this.peek();
      if (c === "\n") this.newline();
      else if (c === " " || c === "\t" || c === "\r") this.i++;
      else return true;
    }
  }

  /** The escape after a backslash (already consumed) in a basic string. */
  private escape(): string {
    const e = this.src[this.i++];
    if (e === "u" || e === "U") {
      const len = e === "u" ? 4 : 8;
      const hex = this.src.slice(this.i, this.i + len);
      const code = Number.parseInt(hex, 16);
      // A Unicode scalar value: exactly `len` hex digits, not a surrogate, at most U+10FFFF.
      if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        this.fail("invalid unicode escape");
      }
      this.i += len;
      return String.fromCodePoint(code);
    }
    if (e !== undefined && e in ESCAPES) return ESCAPES[e];
    return this.fail(`invalid escape \\${e ?? ""}`);
  }

  private array(path: (string | number)[]): TomlValue[] {
    this.i++;
    const items: TomlValue[] = [];
    for (;;) {
      this.skipBlank();
      if (this.peek() === "]") {
        this.i++;
        return items;
      }
      items.push(this.value([...path, items.length]));
      this.skipBlank();
      if (this.peek() === ",") this.i++;
      else if (this.peek() !== "]") this.fail("expected ',' or ']' in array");
    }
  }

  private inlineTable(path: (string | number)[]): TomlTable {
    this.i++;
    const table: TomlTable = {};
    this.skipSpaces();
    if (this.peek() === "}") {
      this.i++;
      return table;
    }
    for (;;) {
      this.skipSpaces();
      const keys = this.keyPath("=");
      this.expect("=");
      this.assign(table, path, keys);
      this.skipSpaces();
      const c = this.src[this.i++];
      if (c === "}") return table;
      if (c !== ",") this.fail("expected ',' or '}' in inline table");
    }
  }

  // ── Keys ───────────────────────────────────────────────────────────────

  /** A dotted key, up to (not including) `stop`. */
  private keyPath(stop: string): string[] {
    const path: string[] = [];
    for (;;) {
      this.skipSpaces();
      const c = this.peek();
      if (c === '"' || c === "'") path.push(this.string());
      else {
        const start = this.i;
        while (!this.eof() && BARE_KEY.test(this.peek())) this.i++;
        if (this.i === start) this.fail(`expected a key before '${stop}'`);
        path.push(this.src.slice(start, this.i));
      }
      this.skipSpaces();
      if (this.peek() !== ".") return path;
      this.i++;
    }
  }

  // Keys come from untrusted files: read with Object.hasOwn and write with
  // defineProperty, so `__proto__` or `constructor` stay plain data instead of
  // reaching (and polluting) a prototype.
  /** Walk (creating) tables along `keys`; an array of tables on the way means its last table. */
  private descend(root: TomlTable, keys: readonly string[], from: (string | number)[] = []): { table: TomlTable; path: (string | number)[] } {
    let current = root;
    const path = [...from];
    for (const key of keys) {
      if (!Object.hasOwn(current, key)) setOwn(current, key, {});
      let next = current[key];
      path.push(key);
      if (Array.isArray(next) && this.tableArrays.has(next)) {
        path.push(next.length - 1);
        next = next[next.length - 1];
      }
      if (!isTable(next)) this.fail(`'${key}' is not a table`);
      current = next;
    }
    return { table: current, path };
  }

  /** `[[keys]]`: a new table appended to the array at `keys`. */
  private appendTable(root: TomlTable, keys: readonly string[]): { table: TomlTable; path: (string | number)[] } {
    const parent = this.descend(root, keys.slice(0, -1));
    const key = keys[keys.length - 1];
    if (!Object.hasOwn(parent.table, key)) {
      const created: TomlValue[] = [];
      this.tableArrays.add(created);
      setOwn(parent.table, key, created);
    }
    const list = parent.table[key];
    if (!Array.isArray(list) || !this.tableArrays.has(list)) this.fail(`'${keys.join(".")}' is not an array of tables`);
    const table: TomlTable = {};
    list.push(table);
    const path = [...parent.path, key, list.length - 1];
    this.lines?.set(JSON.stringify(path), this.line);
    return { table, path };
  }

  /** Read the value for `keys` (relative to `table`, which sits at `tablePath`) and store it. */
  private assign(table: TomlTable, tablePath: (string | number)[], keys: readonly string[]): void {
    const parent = this.descend(table, keys.slice(0, -1), tablePath);
    const key = keys[keys.length - 1];
    if (Object.hasOwn(parent.table, key)) this.fail(`duplicate key '${keys.join(".")}'`);
    setOwn(parent.table, key, this.value([...parent.path, key]));
  }

  // ── Lexing ─────────────────────────────────────────────────────────────

  private endOfLine(): void {
    this.skipSpaces();
    if (this.peek() === "#") this.skipComment();
    if (!this.eof() && this.peek() !== "\n" && this.peek() !== "\r") this.fail("unexpected text after value");
  }

  /** Whitespace, newlines and comments. */
  private skipBlank(): void {
    for (;;) {
      this.skipSpaces();
      const c = this.peek();
      if (c === "#") this.skipComment();
      else if (c === "\n") this.newline();
      else if (c === "\r") this.i++;
      else return;
    }
  }

  private newline(): void {
    this.line++;
    this.i++;
  }

  private skipSpaces(): void {
    while (this.peek() === " " || this.peek() === "\t") this.i++;
  }

  private skipComment(): void {
    while (!this.eof() && this.peek() !== "\n") this.i++;
  }

  private expect(c: string): void {
    this.skipSpaces();
    if (this.src[this.i] !== c) this.fail(`expected '${c}'`);
    this.i++;
  }

  private peek(): string {
    return this.src[this.i] ?? "";
  }

  private eof(): boolean {
    return this.i >= this.src.length;
  }

  private fail(message: string): never {
    throw new TomlSyntaxError(message, this.line);
  }
}

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value);
}
