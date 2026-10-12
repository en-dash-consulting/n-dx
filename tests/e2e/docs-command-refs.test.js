/**
 * Every CLI command and MCP tool the user docs name exists in the build.
 *
 * Reads the code in docs/index.md, docs/guide/** and docs/packages/** (inline
 * code spans and fenced blocks) and checks each reference against the built
 * surface it names:
 *
 *  - `rex <cmd>`, `sv|sourcevision <cmd>`, `hench <cmd>` (bare or behind
 *    `ndx`): the COMMANDS section of that package's built `--help`.
 *  - `ndx <cmd>`: the orchestrator registry (packages/core/help.js).
 *  - snake_case MCP tool names: the assistant-assets manifest, which
 *    codex-mcp-contract.test.js pins to the tools the built servers register.
 *
 * A doc that names a removed or renamed command sends the reader to "unknown
 * command"; this is the check that the docs follow the release build. The
 * archive and the contributor/architecture pages are out of scope: they
 * record history and internals, not what to type.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { execFileSync } from "child_process";
import { getOrchestratorCommands } from "../../packages/core/help.js";
import { getManifest } from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");
const DOCS = join(ROOT, "docs");

/** The user-facing pages: what a reader is told to run. */
function userDocPages() {
  const pages = [join(DOCS, "index.md")];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".md")) pages.push(path);
    }
  };
  walk(join(DOCS, "guide"));
  walk(join(DOCS, "packages"));
  return pages;
}

/** The text a reader would type: inline code spans and fenced block bodies. */
export function codeText(markdown) {
  const text = markdown.replace(/\r\n/g, "\n");
  const chunks = [];
  const withoutFences = text.replace(/^(```|~~~)[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm, (_, _fence, body) => {
    chunks.push(body);
    return "";
  });
  for (const m of withoutFences.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g)) chunks.push(m[2]);
  return chunks;
}

/** Command names in a built CLI's `--help` COMMANDS section. */
function helpCommands(pkg, binName) {
  const out = execFileSync(process.execPath, [join(ROOT, "packages", pkg, "dist/cli/index.js"), "--help"], {
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const section = out.split(/\n(?=[A-Z][A-Z ]+\n)/).find((s) => s.startsWith("COMMANDS"));
  if (!section) throw new Error(`${binName} --help has no COMMANDS section`);
  const names = new Set();
  for (const line of section.split("\n").slice(1)) {
    const tokens = line.trim().split(/\s+/);
    const name = tokens[0] === binName ? tokens[1] : tokens[0];
    if (name && /^[a-z][a-z0-9-]*$/.test(name)) names.add(name);
  }
  return names;
}

/**
 * A command word ends at whitespace, the end of the code, or closing
 * punctuation. A word followed by `:` or `/` is not a command: in
 * `claude mcp add rex http://…` the `rex http` pair is a server name and a URL.
 */
const WORD_END = String.raw`(?=$|[\s` + "`" + String.raw`'"),;|&])`;

/**
 * `<tool> <subcommand>` references in code text. The tool word must start a
 * command (line start, after `ndx`, or after a shell separator), so paths
 * such as `.rex/` and `@n-dx/rex` and keys such as `rex.applyOn` never match.
 * The tool and its subcommand are separated by exactly one space: wider gaps
 * are aligned columns in a diagram (`hench      agent loops`), and a newline
 * ends the command.
 */
export function subcommandRefs(chunk, tool) {
  const re = new RegExp(String.raw`(?:^|[ \t;|&(]|\bndx )` + tool + String.raw` ([a-z][a-z0-9-]*)` + WORD_END, "gm");
  return [...chunk.matchAll(re)].map((m) => m[1]);
}

/** `ndx <cmd>` references; `ndx rex …` yields `rex`, a registry command. */
export function ndxRefs(chunk) {
  const re = new RegExp(String.raw`(?:^|[ \t;|&(])ndx ([a-z][a-z0-9-]*)` + WORD_END, "gm");
  return [...chunk.matchAll(re)].map((m) => m[1]);
}

const manifest = getManifest();
const MCP_TOOLS = new Set(
  Object.values(manifest.mcpServers).flatMap((s) => [...s.tools.read, ...s.tools.write]),
);
/** First words of real tool names; a snake_case token starting with one is a tool reference. */
const TOOL_VERBS = new Set([...MCP_TOOLS].filter((t) => t.includes("_")).map((t) => t.split("_")[0]));

/** snake_case MCP tool references, with any `mcp__<server>__` prefix removed. */
export function mcpToolRefs(chunk) {
  return [...chunk.matchAll(/\b(?:mcp__[a-z]+__)?([a-z]+(?:_[a-z]+)+)\b/g)]
    .map((m) => m[1])
    .filter((name) => TOOL_VERBS.has(name.split("_")[0]));
}

describe("docs reference parsing", () => {
  it("reads code spans and fenced blocks, not prose", () => {
    const md = "Run rex bogus in prose.\n\n`rex status`\n\n```sh\nndx rex product show\nsv analyze .\n```\n";
    const chunks = codeText(md);
    // Fenced blocks are collected before inline spans.
    expect(chunks.flatMap((c) => subcommandRefs(c, "rex"))).toEqual(["product", "status"]);
    expect(chunks.flatMap((c) => subcommandRefs(c, "sv"))).toEqual(["analyze"]);
  });

  it("ignores paths, config keys and MCP server names that contain a tool name", () => {
    const chunks = codeText(
      "`.rex/prd_tree/` `@n-dx/rex` `rex.applyOn` `.ndx/rex/product`\n\n" +
        "```sh\nclaude mcp add --transport http rex http://localhost:3117/mcp/rex\nclaude mcp remove rex\nclaude mcp list\n```\n" +
        "```\n  hench                         agent loops\n```\n",
    );
    expect(chunks.flatMap((c) => subcommandRefs(c, "rex"))).toEqual([]);
    expect(chunks.flatMap((c) => subcommandRefs(c, "hench"))).toEqual([]);
  });

  it("finds MCP tool names with or without the client prefix", () => {
    expect(mcpToolRefs("`mcp__rex__get_product` and `place_changes` and `needs_placement`")).toEqual([
      "get_product",
      "place_changes",
    ]);
  });
});

describe("user docs name only commands and MCP tools the build has", () => {
  const surfaces = {
    rex: helpCommands("rex", "rex"),
    sourcevision: helpCommands("sourcevision", "sourcevision"),
    hench: helpCommands("hench", "hench"),
  };
  surfaces.sv = surfaces.sourcevision;
  const orchestrator = new Set(getOrchestratorCommands());
  // Dispatched by cli.js but absent from the help registry. `iso` is tracked
  // in command-docs-parity.test.js KNOWN_UNREGISTERED; `mcp` is the stdio
  // bridge that MCP registrations launch (`ndx mcp <server>`).
  for (const name of ["iso", "mcp"]) orchestrator.add(name);

  /**
   * References a page makes on purpose to a command that does not exist: a
   * troubleshooting entry quoting what the reader mistyped.
   */
  const QUOTED_MISTAKES = new Set(["docs/guide/troubleshooting.md: rex plan"]);

  const pages = userDocPages().map((path) => ({
    name: relative(ROOT, path).split("\\").join("/"),
    chunks: codeText(readFileSync(path, "utf-8")),
  }));

  it("finds pages to check", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it("every quoted mistake is still quoted, and still not a command", () => {
    for (const ref of QUOTED_MISTAKES) {
      const [page, call] = ref.split(": ");
      const [tool, cmd] = call.split(" ");
      expect(readFileSync(join(ROOT, page), "utf-8"), ref).toContain(call);
      expect(surfaces[tool].has(cmd), ref).toBe(false);
    }
  });

  for (const [tool, commands] of Object.entries(surfaces)) {
    it(`every \`${tool} <command>\` exists in ${tool} --help`, () => {
      const unknown = pages
        .flatMap((p) =>
          p.chunks.flatMap((c) => subcommandRefs(c, tool)).filter((cmd) => !commands.has(cmd)).map((cmd) => `${p.name}: ${tool} ${cmd}`),
        )
        .filter((ref) => !QUOTED_MISTAKES.has(ref));
      expect([...new Set(unknown)]).toEqual([]);
    });
  }

  it("every `ndx <command>` is an orchestrator command", () => {
    const unknown = pages.flatMap((p) =>
      p.chunks.flatMap(ndxRefs).filter((cmd) => !orchestrator.has(cmd)).map((cmd) => `${p.name}: ndx ${cmd}`),
    );
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("the MCP Integration page has a row for every registered tool", () => {
    const page = readFileSync(join(DOCS, "guide/mcp.md"), "utf-8").replace(/\r\n/g, "\n");
    const rows = new Set([...page.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]));
    expect([...MCP_TOOLS].filter((tool) => !rows.has(tool))).toEqual([]);
  });

  it("every MCP tool name is registered by a built server", () => {
    const unknown = pages.flatMap((p) =>
      p.chunks.flatMap(mcpToolRefs).filter((name) => !MCP_TOOLS.has(name)).map((name) => `${p.name}: ${name}`),
    );
    expect([...new Set(unknown)]).toEqual([]);
  });
});
