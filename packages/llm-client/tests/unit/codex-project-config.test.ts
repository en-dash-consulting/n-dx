import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CodexProjectConfigError,
  codexConfigMcpServerNames,
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

  it("disables every declared server but the kept ones, quoting a name that is not a bare key", () => {
    writeConfig(join(root, "repo"), '[mcp_servers.rex]\ncommand = "ndx"\n[mcp_servers.sourcevision]\ncommand = "ndx"\n[mcp_servers.ndx-sidecar]\nurl = "u"\n');
    writeConfig(join(root, "repo", "pkg"), '[mcp_servers."my server"]\ncommand = "x"\n[mcp_servers.rex]\ncommand = "y"\n');
    writeConfig(root, '[mcp_servers.outside]\ncommand = "z"\n');
    expect(codexProjectMcpDisableFlags(join(root, "repo", "pkg", "src"), ["ndx-sidecar"])).toEqual([
      "-c", 'mcp_servers."my server".enabled=false',
      "-c", "mcp_servers.rex.enabled=false",
      "-c", "mcp_servers.sourcevision.enabled=false",
    ]);
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
