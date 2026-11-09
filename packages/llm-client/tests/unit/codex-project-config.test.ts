import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CodexProjectConfigError,
  CODEX_DISABLED_MCP_URL,
  codexConfigMcpServerNames,
  codexConfigMcpServers,
  codexProjectConfigPaths,
  codexProjectMcpDisableFlags,
} from "../../src/codex-project-config.js";

describe("codexConfigMcpServerNames", () => {
  it("reads the servers ndx init writes", () => {
    const text = [
      "# n-dx MCP servers",
      "[mcp_servers.rex]",
      'command = "ndx"',
      'args = ["rex", "mcp", "."]',
      "",
      "[mcp_servers.sourcevision]",
      'command = "ndx"',
      "args = [",
      '  "sv",  # stdio',
      '  "mcp",',
      '  ".",',
      "]",
    ].join("\n");
    expect(codexConfigMcpServerNames(text)).toEqual(["rex", "sourcevision"]);
  });

  it("reads subtables, quoted names, dotted keys and inline tables", () => {
    const text = [
      'model = "o3"',
      "[mcp_servers.a.env]",
      'KEY = "v"',
      '[mcp_servers."b c"]',
      "url = 'https://x'",
      "[mcp_servers]",
      'd = { command = "x" }',
      'e.command = "y"',
      "[profiles.p]",
      'mcp_servers.not_top = "ignored"',
    ].join("\n");
    expect(codexConfigMcpServerNames(text)).toEqual(["a", "b c", "d", "e"]);
    expect(codexConfigMcpServerNames('mcp_servers.f.command = "x"\nmcp_servers = { g = { url = "u" }, "h.i" = {} }'))
      .toEqual(["f", "g", "h.i"]);
  });

  it("reports each server's transport keys in all three forms, ignoring nested tables", () => {
    const text = [
      "[mcp_servers.a]",
      'command = "x"',
      "[mcp_servers.a.env]",
      'url = "not a transport"',
      "[mcp_servers]",
      'b = { url = "u", env = { command = "nested" } }',
      'c.command = "y"',
      'c.url = "z"',
      "[other]",
      'mcp_servers.d.command = "profile-scoped, ignored"',
    ].join("\n");
    expect(codexConfigMcpServers(text)).toEqual([
      { name: "a", transports: ["command"] },
      { name: "b", transports: ["url"] },
      { name: "c", transports: ["command", "url"] },
    ]);
    expect(codexConfigMcpServers('mcp_servers = { e = { command = "x" }, f = { args = [] } }\nmcp_servers.g.url = "u"')).toEqual([
      { name: "e", transports: ["command"] },
      { name: "f", transports: [] },
      { name: "g", transports: ["url"] },
    ]);
  });

  it("skips strings that only look like declarations", () => {
    const text = [
      'note = """',
      "[mcp_servers.fake]",
      '"""',
      "lit = '''",
      "mcp_servers.fake2 = 1",
      "'''",
      'x = "[mcp_servers.fake3]" # [mcp_servers.fake4]',
    ].join("\n");
    expect(codexConfigMcpServerNames(text)).toEqual([]);
  });

  it.each([
    ["a malformed header", "[mcp_servers.rex"],
    ["an unterminated string", '[mcp_servers.rex]\ncommand = "ndx'],
    ["an unterminated multi-line string", 'x = """\nmore'],
    ["an unterminated array", "x = [1, 2"],
    ["a non-table mcp_servers", 'mcp_servers = "rex"'],
    ["an array of server tables", "[[mcp_servers]]\nname = 'rex'"],
    ["an escape it does not decode", '[mcp_servers."r\\U0001F600"]'],
    ["trailing text", "x = 1 2"],
  ])("throws on %s", (_label, text) => {
    expect(() => codexConfigMcpServerNames(text)).toThrow(/line \d+/);
  });
});

describe("project config files", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "codex-project-config-"));
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    mkdirSync(join(root, "repo", "pkg", "src"), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(dir: string, text: string): string {
    mkdirSync(join(dir, ".codex"), { recursive: true });
    const file = join(dir, ".codex", "config.toml");
    writeFileSync(file, text);
    return file;
  }

  it("looks from the cwd up to the repository root and no further", () => {
    expect(codexProjectConfigPaths(join(root, "repo", "pkg"))).toEqual([
      join(root, "repo", "pkg", ".codex", "config.toml"),
      join(root, "repo", ".codex", "config.toml"),
    ]);
  });

  it("disables every declared server but the kept ones, each with its transport's placeholder", () => {
    writeConfig(join(root, "repo"), '[mcp_servers.rex]\ncommand = "ndx"\n[mcp_servers.sourcevision]\ncommand = "ndx"\n[mcp_servers.ndx-sidecar]\nurl = "u"\n');
    writeConfig(join(root, "repo", "pkg"), '[mcp_servers.my_server]\nurl = "https://x"\n[mcp_servers.rex]\ncommand = "y"\n');
    writeConfig(root, '[mcp_servers.outside]\ncommand = "z"\n');
    expect(codexProjectMcpDisableFlags(join(root, "repo", "pkg", "src"), ["ndx-sidecar"])).toEqual([
      "-c", "mcp_servers.my_server.enabled=false",
      "-c", `mcp_servers.my_server.url="${CODEX_DISABLED_MCP_URL}"`,
      "-c", "mcp_servers.rex.enabled=false",
      "-c", 'mcp_servers.rex.command="ndx-sidecar-disabled"',
      "-c", "mcp_servers.sourcevision.enabled=false",
      "-c", 'mcp_servers.sourcevision.command="ndx-sidecar-disabled"',
    ]);
    expect(CODEX_DISABLED_MCP_URL).toBe("http://127.0.0.1:9/ndx-sidecar-disabled");
  });

  // codex-cli 0.166.0 does not load the project file under --ignore-user-config,
  // so the entry Codex builds is the overrides alone: each must be valid by itself.
  it("gives each server, from the overrides alone, exactly one transport and enabled=false", () => {
    writeConfig(join(root, "repo"), [
      'mcp_servers.sourcevision.command = "ndx"',
      "[mcp_servers.rex]", 'command = "ndx"', 'args = ["rex", "mcp", "."]',
      "[mcp_servers.remote]", 'url = "https://example.test/mcp"',
      "[mcp_servers.ndx-sidecar]", 'url = "u"',
    ].join("\n"));
    const flags = codexProjectMcpDisableFlags(join(root, "repo"), ["ndx-sidecar"]);
    const values = flags.filter((_, i) => i % 2 === 1);
    expect(flags.filter((_, i) => i % 2 === 0).every((flag) => flag === "-c")).toBe(true);
    // Each -c value is a TOML `key=value` line; together they are the config Codex builds without the file.
    const overrides = codexConfigMcpServers(values.join("\n"));
    expect(overrides.map((server) => server.name)).toEqual(["sourcevision", "rex", "remote"]);
    for (const server of overrides) {
      expect(server.transports).toHaveLength(1);
      expect(values).toContain(`mcp_servers.${server.name}.enabled=false`);
    }
    expect(overrides.find((server) => server.name === "remote")?.transports).toEqual(["url"]);
  });

  it.each([
    ["neither command nor url", '[mcp_servers.half]\nargs = ["x"]\n'],
    ["both command and url", '[mcp_servers.half]\ncommand = "x"\nurl = "https://x"\n'],
  ])("refuses a server that declares %s, naming the file and the server", (found, text) => {
    const file = writeConfig(join(root, "repo"), text);
    const call = () => codexProjectMcpDisableFlags(join(root, "repo"), ["ndx-sidecar"]);
    expect(call).toThrow(CodexProjectConfigError);
    expect(call).toThrow(file);
    expect(call).toThrow(`"half" with ${found}`);
  });

  it("counts a transport set in another layer of the project config", () => {
    writeConfig(join(root, "repo"), '[mcp_servers.rex]\ncommand = "ndx"\n');
    writeConfig(join(root, "repo", "pkg"), '[mcp_servers.rex]\nargs = ["rex"]\n');
    expect(codexProjectMcpDisableFlags(join(root, "repo", "pkg"))).toEqual([
      "-c", "mcp_servers.rex.enabled=false",
      "-c", 'mcp_servers.rex.command="ndx-sidecar-disabled"',
    ]);
  });

  // Whether codex's -c parser honours a quoted path segment is unverified on
  // the real CLI, so a name no bare path can address refuses the turn.
  it.each(["a.b", "my server"])("refuses a server named %j, naming the file and the server", (name) => {
    writeConfig(join(root, "repo"), "[mcp_servers.rex]\ncommand = \"ndx\"\n");
    const file = writeConfig(join(root, "repo", "pkg"), `[mcp_servers.${JSON.stringify(name)}]\ncommand = "x"\n`);
    const call = () => codexProjectMcpDisableFlags(join(root, "repo", "pkg"), ["ndx-sidecar"]);
    expect(call).toThrow(CodexProjectConfigError);
    expect(call).toThrow(file);
    expect(call).toThrow(JSON.stringify(name));
  });

  it("does not refuse a kept server whatever its name", () => {
    writeConfig(join(root, "repo"), '[mcp_servers."a.b"]\nurl = "u"\n');
    expect(codexProjectMcpDisableFlags(join(root, "repo"), ["a.b"])).toEqual([]);
  });

  it("gives no flags without a project config", () => {
    expect(codexProjectMcpDisableFlags(join(root, "repo"))).toEqual([]);
  });

  it("refuses an unparseable config, naming the file", () => {
    const file = writeConfig(join(root, "repo"), "[mcp_servers.rex\n");
    expect(() => codexProjectMcpDisableFlags(join(root, "repo", "pkg"))).toThrow(CodexProjectConfigError);
    expect(() => codexProjectMcpDisableFlags(join(root, "repo", "pkg"))).toThrow(file);
  });

  it("refuses a config that exists but cannot be read", () => {
    mkdirSync(join(root, "repo", ".codex", "config.toml"), { recursive: true });
    const file = join(root, "repo", ".codex", "config.toml");
    expect(() => codexProjectMcpDisableFlags(join(root, "repo"))).toThrow(new RegExp(`${file.replace(/[\\.]/g, "\\$&")}: cannot be read`));
  });
});
