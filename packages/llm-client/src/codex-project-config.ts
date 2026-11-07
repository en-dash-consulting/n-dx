/**
 * The MCP servers a repository's own Codex config declares, and the `-c`
 * flags that turn them off.
 *
 * `codex exec --ignore-user-config` skips only `$CODEX_HOME/config.toml`. A
 * repository's `.codex/config.toml` (`ndx init` writes one with rex and
 * sourcevision stdio servers) may still load as project config, in the
 * working directory or any directory above it up to the repository root. A
 * caller that must run Codex with no MCP server but its own reads every such
 * file and disables each server it names.
 *
 * Fail closed. {@link codexConfigMcpServerNames} parses the whole file with a
 * strict TOML subset: anything it cannot parse — a malformed header, an
 * unterminated string, a value form it does not know — throws rather than
 * being skipped, because a skipped line could be the one that declares a
 * server. (`codex-user-config.ts` reads the user's config the other way:
 * leniently, since a key it misses only leaves a feature off.)
 *
 * @module llm-client/codex-project-config
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** A project `.codex/config.toml` that exists but cannot be read with confidence. */
export class CodexProjectConfigError extends Error {
  constructor(
    /** The config file. */
    readonly file: string,
    reason: string,
  ) {
    super(`${file}: ${reason}`);
    this.name = "CodexProjectConfigError";
  }
}

class TomlSubsetError extends Error {}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;
/** Numbers, booleans, dates and times: whatever is left once strings, arrays and tables are excluded. */
const SCALAR_CHAR = /[A-Za-z0-9_+\-.:]/;

/** What a value contributes to server names: an inline table's entry keys. */
interface ScannedValue {
  tableKeys?: string[][];
}

class Scanner {
  private i = 0;

  constructor(private readonly s: string) {
    if (s.startsWith("﻿")) this.i = 1;
  }

  /** Every top-level `mcp_servers` server name, in order of first mention. */
  serverNames(): string[] {
    const names: string[] = [];
    const add = (name: string) => {
      if (!names.includes(name)) names.push(name);
    };
    let table: string[] = [];
    for (;;) {
      this.skipBlank();
      if (this.eof()) return names;
      if (this.peek() === "[") {
        const arrayTable = this.peek(1) === "[";
        this.i += arrayTable ? 2 : 1;
        this.skipInline();
        table = this.key();
        this.expect(arrayTable ? "]]" : "]");
        this.endOfLine();
        if (table[0] === "mcp_servers") {
          if (table.length >= 2) add(table[1]);
          else if (arrayTable) this.fail("[[mcp_servers]] declares no server name");
        }
        continue;
      }
      const path = [...table, ...this.key()];
      this.expect("=");
      this.skipInline();
      const value = this.value();
      this.endOfLine();
      if (path[0] !== "mcp_servers") continue;
      if (path.length >= 2) add(path[1]);
      else if (value.tableKeys) value.tableKeys.forEach((key) => add(key[0]));
      else this.fail("mcp_servers is assigned something other than a table");
    }
  }

  // ── keys ─────────────────────────────────────────────────────────────

  /** A dotted key, each segment unquoted; trailing inline whitespace consumed. */
  private key(): string[] {
    const path: string[] = [];
    for (;;) {
      this.skipInline();
      const ch = this.peek();
      if (ch === "\"") path.push(this.basicString());
      else if (ch === "'") path.push(this.literalString());
      else {
        const start = this.i;
        while (!this.eof() && BARE_KEY_CHAR.test(this.peek())) this.i++;
        if (this.i === start) this.fail(`expected a key, found ${this.describe()}`);
        path.push(this.s.slice(start, this.i));
      }
      this.skipInline();
      if (this.peek() !== ".") return path;
      this.i++;
    }
  }

  // ── values ───────────────────────────────────────────────────────────

  private value(): ScannedValue {
    const ch = this.peek();
    if (this.s.startsWith("\"\"\"", this.i)) this.multilineString("\"\"\"");
    else if (this.s.startsWith("'''", this.i)) this.multilineString("'''");
    else if (ch === "\"") this.basicString();
    else if (ch === "'") this.literalString();
    else if (ch === "[") this.array();
    else if (ch === "{") return { tableKeys: this.inlineTable() };
    else this.scalar();
    return {};
  }

  private array(): void {
    this.i++;
    for (;;) {
      this.skipBlank();
      if (this.peek() === "]") break;
      this.value();
      this.skipBlank();
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      if (this.peek() !== "]") this.fail(`expected "," or "]" in an array, found ${this.describe()}`);
      break;
    }
    this.i++;
  }

  /** The inline table's entry keys. Newlines inside are accepted (TOML 1.1). */
  private inlineTable(): string[][] {
    this.i++;
    const keys: string[][] = [];
    for (;;) {
      this.skipBlank();
      if (this.peek() === "}") break;
      keys.push(this.key());
      this.expect("=");
      this.skipInline();
      this.value();
      this.skipBlank();
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      if (this.peek() !== "}") this.fail(`expected "," or "}" in an inline table, found ${this.describe()}`);
      break;
    }
    this.i++;
    return keys;
  }

  private scalar(): void {
    const start = this.i;
    while (!this.eof() && SCALAR_CHAR.test(this.peek())) this.i++;
    if (this.i === start) this.fail(`expected a value, found ${this.describe()}`);
  }

  // ── strings ──────────────────────────────────────────────────────────

  private basicString(): string {
    const start = ++this.i;
    while (!this.eof() && this.peek() !== "\"") {
      if (this.peek() === "\n") break;
      if (this.peek() === "\\") this.i++;
      this.i++;
    }
    if (this.peek() !== "\"") this.fail("unterminated string");
    const raw = this.s.slice(start, this.i++);
    try {
      // JSON's escapes are TOML's minus \U and \e; a string using those is refused, not guessed.
      return JSON.parse(`"${raw.replace(/\t/g, "\\t")}"`) as string;
    } catch {
      return this.fail(`string ${JSON.stringify(raw)} has an escape this reader does not decode`);
    }
  }

  private literalString(): string {
    const start = ++this.i;
    while (!this.eof() && this.peek() !== "'" && this.peek() !== "\n") this.i++;
    if (this.peek() !== "'") this.fail("unterminated string");
    return this.s.slice(start, this.i++);
  }

  private multilineString(delimiter: "\"\"\"" | "'''"): void {
    this.i += 3;
    for (;;) {
      if (this.eof()) this.fail("unterminated multi-line string");
      if (delimiter === "\"\"\"" && this.peek() === "\\") {
        this.i += 2;
        continue;
      }
      if (this.s.startsWith(delimiter, this.i)) {
        this.i += 3;
        // Up to two quotes may sit directly before the closing delimiter.
        for (let extra = 0; extra < 2 && this.peek() === delimiter[0]; extra++) this.i++;
        return;
      }
      this.i++;
    }
  }

  // ── layout ───────────────────────────────────────────────────────────

  private skipInline(): void {
    while (this.peek() === " " || this.peek() === "\t") this.i++;
  }

  /** Whitespace, newlines and comments. */
  private skipBlank(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") this.i++;
      else if (ch === "#") this.skipComment();
      else return;
    }
  }

  private skipComment(): void {
    while (!this.eof() && this.peek() !== "\n") this.i++;
  }

  private endOfLine(): void {
    this.skipInline();
    if (this.peek() === "#") this.skipComment();
    if (this.peek() === "\r") this.i++;
    if (this.eof()) return;
    if (this.peek() !== "\n") this.fail(`expected the end of the line, found ${this.describe()}`);
    this.i++;
  }

  private expect(token: string): void {
    this.skipInline();
    if (!this.s.startsWith(token, this.i)) this.fail(`expected "${token}", found ${this.describe()}`);
    this.i += token.length;
  }

  private peek(offset = 0): string {
    return this.s[this.i + offset] ?? "";
  }

  private eof(): boolean {
    return this.i >= this.s.length;
  }

  private describe(): string {
    return this.eof() ? "the end of the file" : JSON.stringify(this.s.slice(this.i, this.i + 12));
  }

  private fail(message: string): never {
    const line = this.s.slice(0, this.i).split("\n").length;
    throw new TomlSubsetError(`line ${line}: ${message}`);
  }
}

/**
 * The top-level `mcp_servers` names a Codex config declares: from
 * `[mcp_servers.<name>]` headers and their subtables, dotted keys
 * `mcp_servers.<name>.<key> = …` and an inline `mcp_servers = { … }` table.
 *
 * @throws Error when any part of the text is outside the subset this reads.
 */
export function codexConfigMcpServerNames(text: string): string[] {
  return new Scanner(text).serverNames();
}

/**
 * Every `.codex/config.toml` Codex may load as project config for `cwd`: in
 * `cwd` and each directory above it, up to the repository root (the first
 * directory holding `.git`), or to the filesystem root outside a repository.
 * Paths are listed whether or not the file exists.
 */
export function codexProjectConfigPaths(cwd: string): string[] {
  const paths: string[] = [];
  let dir = resolve(cwd);
  for (;;) {
    paths.push(join(dir, ".codex", "config.toml"));
    if (existsSync(join(dir, ".git"))) return paths;
    const parent = dirname(dir);
    if (parent === dir) return paths;
    dir = parent;
  }
}

/**
 * The MCP server names every project `.codex/config.toml` for `cwd` declares
 * ({@link codexProjectConfigPaths}), in order of first mention.
 *
 * @throws CodexProjectConfigError naming the file when one exists but cannot
 *   be read, or cannot be parsed with confidence.
 */
export function codexProjectMcpServerNames(cwd: string): string[] {
  const names: string[] = [];
  for (const file of codexProjectConfigPaths(cwd)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw new CodexProjectConfigError(file, `cannot be read (${code ?? (error as Error).message})`);
    }
    let found: string[];
    try {
      found = codexConfigMcpServerNames(text);
    } catch (error) {
      if (!(error instanceof TomlSubsetError)) throw error;
      throw new CodexProjectConfigError(file, `its MCP servers cannot be read with confidence (${error.message})`);
    }
    for (const name of found) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * `-c mcp_servers.<name>.enabled=false` for every project MCP server `cwd`
 * would load, except those in `keep`. A name that is not a bare TOML key is
 * quoted in the path.
 *
 * @throws CodexProjectConfigError as {@link codexProjectMcpServerNames}.
 */
export function codexProjectMcpDisableFlags(cwd: string, keep: readonly string[] = []): string[] {
  return codexProjectMcpServerNames(cwd)
    .filter((name) => !keep.includes(name))
    .flatMap((name) => ["-c", `mcp_servers.${BARE_KEY.test(name) ? name : JSON.stringify(name)}.enabled=false`]);
}
