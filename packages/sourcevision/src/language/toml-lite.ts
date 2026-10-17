/**
 * A small TOML reader for Gradle version catalogs (`gradle/libs.versions.toml`).
 * Understands tables, dotted keys, basic and literal strings, arrays (also
 * across lines), inline tables, booleans and numbers. Multi-line strings,
 * dates and arrays of tables are not part of a catalog and are rejected
 * rather than misread. No regular expressions, no dependency.
 *
 * @module sourcevision/language/toml-lite
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

const ESCAPES: Readonly<Record<string, string>> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
const BARE_KEY = /[A-Za-z0-9_-]/;

export function parseToml(src: string): TomlTable {
  return new Reader(src).document();
}

function setOwn(table: TomlTable, key: string, value: TomlValue): void {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
}

class Reader {
  private i = 0;
  private line = 1;

  constructor(private readonly src: string) {}

  document(): TomlTable {
    const root: TomlTable = {};
    let current = root;
    for (;;) {
      this.skipBlank();
      if (this.eof()) return root;
      if (this.peek() === "[") {
        if (this.src[this.i + 1] === "[") this.fail("arrays of tables are not supported");
        this.i++;
        current = this.descend(root, this.keyPath("]"));
        this.expect("]");
      } else {
        const path = this.keyPath("=");
        this.expect("=");
        this.assign(current, path, this.value());
      }
      this.endOfLine();
    }
  }

  // ── Values ─────────────────────────────────────────────────────────────

  private value(): TomlValue {
    this.skipSpaces();
    const c = this.peek();
    if (c === '"' || c === "'") return this.string();
    if (c === "[") return this.array();
    if (c === "{") return this.inlineTable();
    const start = this.i;
    while (!this.eof() && !",]}#\n\r \t".includes(this.peek())) this.i++;
    const word = this.src.slice(start, this.i);
    if (word === "true") return true;
    if (word === "false") return false;
    const n = Number(word);
    if (word !== "" && Number.isFinite(n) && word.split("-").length < 3) return n;
    return this.fail(`unsupported value "${word}"`);
  }

  private string(): string {
    const quote = this.src[this.i];
    if (this.src.startsWith(quote.repeat(3), this.i)) this.fail("multi-line strings are not supported");
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
      const e = this.src[this.i++];
      if (e === "u" || e === "U") {
        const len = e === "u" ? 4 : 8;
        const code = Number.parseInt(this.src.slice(this.i, this.i + len), 16);
        if (!Number.isInteger(code)) this.fail("invalid unicode escape");
        out += String.fromCodePoint(code);
        this.i += len;
      } else if (e !== undefined && e in ESCAPES) out += ESCAPES[e];
      else this.fail(`invalid escape \\${e ?? ""}`);
    }
  }

  private array(): TomlValue[] {
    this.i++;
    const items: TomlValue[] = [];
    for (;;) {
      this.skipBlank();
      if (this.peek() === "]") {
        this.i++;
        return items;
      }
      items.push(this.value());
      this.skipBlank();
      if (this.peek() === ",") this.i++;
      else if (this.peek() !== "]") this.fail("expected ',' or ']' in array");
    }
  }

  private inlineTable(): TomlTable {
    this.i++;
    const table: TomlTable = {};
    this.skipSpaces();
    if (this.peek() === "}") {
      this.i++;
      return table;
    }
    for (;;) {
      this.skipSpaces();
      const path = this.keyPath("=");
      this.expect("=");
      this.assign(table, path, this.value());
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
  private descend(table: TomlTable, path: string[]): TomlTable {
    let current = table;
    for (const key of path) {
      if (!Object.hasOwn(current, key)) setOwn(current, key, {});
      const next = current[key];
      if (typeof next !== "object" || Array.isArray(next)) this.fail(`'${key}' is not a table`);
      current = next;
    }
    return current;
  }

  private assign(table: TomlTable, path: string[], value: TomlValue): void {
    const parent = this.descend(table, path.slice(0, -1));
    const key = path[path.length - 1];
    if (Object.hasOwn(parent, key)) this.fail(`duplicate key '${path.join(".")}'`);
    setOwn(parent, key, value);
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
      else if (c === "\n") {
        this.line++;
        this.i++;
      } else if (c === "\r") this.i++;
      else return;
    }
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
