/**
 * The MCP servers a repository's own Codex config declares, and the `-c`
 * flags that turn them off.
 *
 * A repository's `.codex/config.toml` (`ndx init` writes one with rex and
 * sourcevision stdio servers) may load as project config, from the working
 * directory or any directory above it up to the repository root. Whether it
 * loads under `codex exec --ignore-user-config` depends on the build:
 * codex-cli 0.166.0 skips it (a project's config is honoured only when the
 * user config trusts the project, and that flag skips the user config);
 * 0.164.0-alpha.11.1 is unverified. A caller that must run Codex with no MCP
 * server but its own reads every such file and overrides each server it
 * names with a complete, disabled entry ({@link codexProjectMcpDisableFlags}),
 * which is valid either way.
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

/** What a value contributes to server names: an inline table's key paths, nested tables flattened. */
interface ScannedValue {
  tableKeys?: string[][];
}

/** The keys that give a Codex MCP server its transport: stdio (`command`) or Streamable HTTP (`url`). */
export type CodexMcpTransportKey = "command" | "url";

/** An MCP server a Codex config declares, with the transport keys its entry sets. */
export interface CodexMcpServerDeclaration {
  name: string;
  /** `command`, `url`, both or neither, in order of first mention. */
  transports: CodexMcpTransportKey[];
}

function isTransportKey(key: string | undefined): key is CodexMcpTransportKey {
  return key === "command" || key === "url";
}

class Scanner {
  private i = 0;

  constructor(private readonly s: string) {
    if (s.startsWith("﻿")) this.i = 1;
  }

  /** Every top-level `mcp_servers` server, in order of first mention, with its transport keys. */
  servers(): CodexMcpServerDeclaration[] {
    const servers: CodexMcpServerDeclaration[] = [];
    /** A full key path from the document root, as a header, an assignment or an inline table entry sets it. */
    const note = (path: string[]) => {
      if (path[0] !== "mcp_servers" || path.length < 2) return;
      let server = servers.find((s) => s.name === path[1]);
      if (!server) servers.push(server = { name: path[1], transports: [] });
      const key = path[2];
      if (path.length === 3 && isTransportKey(key) && !server.transports.includes(key)) server.transports.push(key);
    };
    let table: string[] = [];
    for (;;) {
      this.skipBlank();
      if (this.eof()) return servers;
      if (this.peek() === "[") {
        const arrayTable = this.peek(1) === "[";
        this.i += arrayTable ? 2 : 1;
        this.skipInline();
        table = this.key();
        this.expect(arrayTable ? "]]" : "]");
        this.endOfLine();
        if (table[0] === "mcp_servers") {
          if (table.length >= 2) note(table);
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
      if (path.length === 1 && !value.tableKeys) this.fail("mcp_servers is assigned something other than a table");
      note(path);
      value.tableKeys?.forEach((key) => note([...path, ...key]));
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

  /**
   * The inline table's key paths: each entry's key, then each key path of a
   * nested inline table under it. Newlines inside are accepted (TOML 1.1).
   */
  private inlineTable(): string[][] {
    this.i++;
    const keys: string[][] = [];
    for (;;) {
      this.skipBlank();
      if (this.peek() === "}") break;
      const key = this.key();
      keys.push(key);
      this.expect("=");
      this.skipInline();
      this.value().tableKeys?.forEach((sub) => keys.push([...key, ...sub]));
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
  return codexConfigMcpServers(text).map((server) => server.name);
}

/**
 * {@link codexConfigMcpServerNames}, each with the transport keys its entry
 * sets directly (`mcp_servers.<name>.command` / `.url`), in all three forms.
 *
 * @throws Error when any part of the text is outside the subset this reads.
 */
export function codexConfigMcpServers(text: string): CodexMcpServerDeclaration[] {
  return new Scanner(text).servers();
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
  return projectMcpServers(cwd).map((server) => server.name);
}

/** A project MCP server: the first file that declares it, and its transport keys across every file. */
interface ProjectMcpServer extends CodexMcpServerDeclaration {
  file: string;
}

/** {@link codexProjectMcpServerNames}, each with the first file that declares it and its transports. */
function projectMcpServers(cwd: string): ProjectMcpServer[] {
  const servers: ProjectMcpServer[] = [];
  for (const file of codexProjectConfigPaths(cwd)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw new CodexProjectConfigError(file, `cannot be read (${code ?? (error as Error).message})`);
    }
    let found: CodexMcpServerDeclaration[];
    try {
      found = codexConfigMcpServers(text);
    } catch (error) {
      if (!(error instanceof TomlSubsetError)) throw error;
      throw new CodexProjectConfigError(file, `its MCP servers cannot be read with confidence (${error.message})`);
    }
    for (const { name, transports } of found) {
      // Codex merges the layers key by key, so a server's entry carries every transport any layer sets.
      const server = servers.find((s) => s.name === name);
      if (!server) servers.push({ name, file, transports: [...transports] });
      else for (const key of transports) if (!server.transports.includes(key)) server.transports.push(key);
    }
  }
  return servers;
}

/** The command a disabled stdio server is given; never run, since the entry is disabled. */
export const CODEX_DISABLED_MCP_COMMAND = "ndx-sidecar-disabled";

/** The url a disabled Streamable HTTP server is given: the discard port on loopback, never contacted. */
export const CODEX_DISABLED_MCP_URL = "http://127.0.0.1:9/ndx-sidecar-disabled";

/**
 * The `-c` overrides that keep every project MCP server `cwd` would load off,
 * except those in `keep`: for each, `enabled=false` and a placeholder for the
 * transport its project entry declares — `command="ndx-sidecar-disabled"`
 * for a stdio server, `url="http://127.0.0.1:9/ndx-sidecar-disabled"` for a
 * Streamable HTTP one.
 *
 * Each override is a complete, valid, disabled entry, so it holds whether or
 * not Codex loaded the project file. codex-cli 0.166.0 does not load it under
 * `--ignore-user-config`, and there `enabled=false` alone builds an entry with
 * no transport, which fails config loading (`invalid transport in
 * mcp_servers.<name>`); 0.164.0-alpha.11.1 is unverified. If the file did
 * load, the placeholder replaces that one key and `enabled=false` keeps the
 * server off; if it did not, the entry built from the overrides alone has
 * exactly one transport and is disabled.
 *
 * Fails closed. A server whose project entry declares neither `command` nor
 * `url`, or both, refuses: no one placeholder is valid for it. Only a bare
 * TOML key (`[A-Za-z0-9_-]+`) is emitted. Whether codex's `-c` parser honours
 * a quoted path segment is unverified on the real CLI: if it splits on `.`,
 * `mcp_servers."a.b"` misses the server and leaves it enabled. So a name that
 * is not a bare key refuses rather than being quoted.
 *
 * @throws CodexProjectConfigError as {@link codexProjectMcpServerNames}, and
 *   naming the file and the server when a server to disable is not a bare key
 *   or does not declare exactly one transport.
 */
export function codexProjectMcpDisableFlags(cwd: string, keep: readonly string[] = []): string[] {
  const servers = projectMcpServers(cwd).filter((server) => !keep.includes(server.name));
  const unaddressable = servers.find((server) => !BARE_KEY.test(server.name));
  if (unaddressable) {
    throw new CodexProjectConfigError(
      unaddressable.file,
      `declares MCP server ${JSON.stringify(unaddressable.name)}, whose name is not a bare TOML key ([A-Za-z0-9_-]), so a -c override cannot be trusted to disable it`,
    );
  }
  const ambiguous = servers.find((server) => server.transports.length !== 1);
  if (ambiguous) {
    const found = ambiguous.transports.length === 0 ? "neither command nor url" : "both command and url";
    throw new CodexProjectConfigError(
      ambiguous.file,
      `declares MCP server ${JSON.stringify(ambiguous.name)} with ${found}, so no disabled entry with exactly one transport can stand in for it`,
    );
  }
  return servers.flatMap((server) => {
    const prefix = `mcp_servers.${server.name}`;
    const placeholder = server.transports[0] === "command"
      ? `${prefix}.command=${JSON.stringify(CODEX_DISABLED_MCP_COMMAND)}`
      : `${prefix}.url=${JSON.stringify(CODEX_DISABLED_MCP_URL)}`;
    return ["-c", `${prefix}.enabled=false`, "-c", placeholder];
  });
}
