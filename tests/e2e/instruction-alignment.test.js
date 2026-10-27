/**
 * Instruction alignment — verifies that Claude and Codex instruction files
 * resolve from the same shared project guidance and contain equivalent
 * base information.
 *
 * This test prevents the two vendor instruction surfaces from drifting
 * apart.  Both CLAUDE.md and AGENTS.md are generated from the same
 * `project-guidance.md` template, and this test verifies:
 *
 *   1. Both files include the same shared project documentation sections
 *   2. CLAUDE.md includes Claude-specific addendum content
 *   3. AGENTS.md excludes Claude-specific content
 *   4. AGENTS.md includes Codex-specific operational sections
 *   5. Both files are generated from the same template (source equivalence)
 *   6. CODEX.md is retired (no longer present)
 *   7. No vendor-neutral section lives only in `claude-addendum.md`
 *
 * (7) is the guard that matters most when editing the assets. Anything placed
 * in `claude-addendum.md` renders into CLAUDE.md and nowhere else, so a section
 * about the *codebase* parked there is silently invisible to Codex. That is how
 * the gateway rules and the PRD write invariant went missing from AGENTS.md for
 * several releases. `CLAUDE_ONLY_HEADINGS` below is the allowlist; grow it only
 * for guidance about Claude Code's own behaviour.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, existsSync, mkdtempSync, rmSync, readFileSync, readdirSync } from "fs";
import { createRequire } from "node:module";
import { join } from "path";
import { tmpdir } from "os";
import {
  renderClaudeMd,
  renderAgentsMd,
  getProjectGuidance,
  getClaudeAddendum,
  getCodexTroubleshooting,
} from "../../packages/core/assistant-assets.js";
import { setupAssistantIntegrations } from "../../packages/core/assistant-integration.js";

const ROOT = join(import.meta.dirname, "../..");

// Force claude CLI discovery to fail so `setupAssistantIntegrations` skips
// the real `claude mcp add` calls (which caused the beforeAll hook to time
// out at 10s). This test only verifies that CLAUDE.md/AGENTS.md are written
// with the right content — file writes happen before MCP registration. See
// packages/core/claude-integration.js:306–320.
process.env.CLAUDE_CLI_PATH = "/nonexistent/path/to/claude";

// ── Render once for all tests ────────────────────────────────────────────────

let claudeContent;
let agentsContent;

beforeAll(() => {
  claudeContent = renderClaudeMd();
  agentsContent = renderAgentsMd();
});

// ── Shared guidance equivalence ──────────────────────────────────────────────

describe("shared guidance equivalence", () => {
  /**
   * Sections from project-guidance.md that must appear in both instruction
   * files.  These are the "SYNC NOTICE" sections that previously required
   * manual mirroring between CLAUDE.md and CODEX.md.
   */
  const sharedSections = [
    "## Packages",
    "### Architecture",
    "### Package conventions",
    "## n-dx Orchestration Commands",
    "## Key Files",
  ];

  for (const heading of sharedSections) {
    it(`both files include "${heading}"`, () => {
      expect(claudeContent, `CLAUDE.md missing: ${heading}`).toContain(heading);
      expect(agentsContent, `AGENTS.md missing: ${heading}`).toContain(heading);
    });
  }

  it("both files describe the same packages", () => {
    for (const pkg of ["sourcevision", "rex", "hench"]) {
      expect(claudeContent).toContain(`**${pkg}**`);
      expect(agentsContent).toContain(`**${pkg}**`);
    }
  });

  it("both files include the four-tier architecture diagram", () => {
    const archMarker = "Four-tier dependency hierarchy";
    expect(claudeContent).toContain(archMarker);
    expect(agentsContent).toContain(archMarker);
  });

  it("both files carry the same v2 write invariant and distinguish v1 storage", () => {
    const invariant = (content) => content.match(/\*\*PRD invariant\.\*\*[^\n]*(?:\n(?!\n)[^\n]*)*/)?.[0];
    expect(invariant(agentsContent)).toBeTruthy();
    expect(invariant(agentsContent)).toBe(invariant(claudeContent));
    expect(invariant(agentsContent)).toContain("product/");
    expect(invariant(agentsContent)).toContain("changes/");
    expect(invariant(agentsContent)).toContain("state.yaml");
    expect(invariant(agentsContent)).toContain("v1");
    for (const content of [agentsContent, claudeContent]) {
      expect(content).toMatch(/capability criteria/i);
      expect(content).toContain("acceptance criteria");
      expect(content).toContain("docs/architecture/public-surface.md");
      expect(content).not.toContain("Subtasks are encoded as sections");
    }
  });

  it("both files include the web zone layering", () => {
    const zoneMarker = "web-server";
    expect(claudeContent).toContain(zoneMarker);
    expect(agentsContent).toContain(zoneMarker);
  });

  it("both files list the same orchestration commands", () => {
    // "ndx plan"/"ndx status"/"ndx start" come from the concurrency contract,
    // which is shared guidance now rather than a Claude-only section.
    const commands = ["ndx init", "ndx work", "ndx start", "ndx plan", "ndx status"];
    for (const cmd of commands) {
      expect(claudeContent, `CLAUDE.md missing cmd: ${cmd}`).toContain(cmd);
      expect(agentsContent, `AGENTS.md missing cmd: ${cmd}`).toContain(cmd);
    }
  });

  it("both files include the same key files", () => {
    // ".rex/workflow.md" appears in the Codex-only Workflow section by
    // design. ".hench/config.json" reaches both files through the
    // spawn-exempt note and the concurrency contract, which are shared.
    const keyFiles = [
      ".sourcevision/CONTEXT.md",
      ".rex/prd.json",
      ".n-dx.json",
      ".hench/config.json",
    ];
    for (const file of keyFiles) {
      expect(claudeContent, `CLAUDE.md missing: ${file}`).toContain(file);
      expect(agentsContent, `AGENTS.md missing: ${file}`).toContain(file);
    }
  });
});

describe("public surface MCP inventory", () => {
  const document = () => readFileSync(join(ROOT, "docs/architecture/public-surface.md"), "utf8");
  const documented = (server, text) => {
    // Documentation may be checked out with CRLF on Windows. Heading
    // boundaries describe Markdown structure, independent of checkout EOL.
    text = text.replace(/\r\n/g, "\n");
    const section = text.split(`## ${server} MCP inventory\n`)[1]?.split("\n## ")[0] ?? "";
    return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]).sort();
  };

  for (const name of ["Rex", "Sourcevision"]) {
    it.each(["LF", "CRLF"])(`lists exactly the ${name} tools returned over MCP (%s document)`, async (eol) => {
      const require = createRequire(join(ROOT, "packages/rex/package.json"));
      const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
      const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
      const dir = mkdtempSync(join(tmpdir(), "ndx-public-surface-"));
      const client = new Client({ name: "public-contract-test", version: "1.0.0" });
      let server;
      try {
        cpSync(join(ROOT, "packages/rex/tests/fixtures/v2-tree"), join(dir, ".rex"), { recursive: true });
        server = name === "Rex"
          ? await (await import("../../packages/rex/dist/public.js")).createRexMcpServer(dir)
          : (await import("../../packages/sourcevision/dist/public.js")).createSourcevisionMcpServer(dir);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        const { tools } = await client.listTools();
        expect(tools.length).toBeGreaterThan(0);
        const text = document().replace(/\r?\n/g, eol === "CRLF" ? "\r\n" : "\n");
        expect(documented(name, text)).toEqual(tools.map((tool) => tool.name).sort());
      } finally {
        await client.close();
        await server?.close();
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    });
  }
});

// ── Vendor-specific content ──────────────────────────────────────────────────

describe("Claude-specific content", () => {
  it("CLAUDE.md explains what .claude/rules/ is for", () => {
    // The seam registries themselves are no longer here, nor in the rule files
    // they used to point at: they live in the owning package's AGENTS.md, so
    // Codex can read them too. What stays Claude-only is the note that
    // `.claude/rules/` holds path-scoped pointers and must not grow a table.
    expect(claudeContent).toContain(".claude/rules/");
    expect(agentsContent).not.toContain(".claude/rules/");
  });

  it("CLAUDE.md includes MCP Servers section", () => {
    expect(claudeContent).toContain("## MCP Servers");
  });

  it("CLAUDE.md does NOT include Codex Troubleshooting", () => {
    expect(claudeContent).not.toContain("## Codex Troubleshooting");
  });

  it("CLAUDE.md points at the per-directory CLAUDE.md files", () => {
    // The one thing that genuinely cannot be shared: Claude Code loads a
    // package's own CLAUDE.md when work happens under that directory. Codex
    // has no equivalent, so the pointers stay in the addendum.
    expect(claudeContent).toContain("packages/web/CLAUDE.md");
    expect(agentsContent).not.toContain("packages/web/CLAUDE.md");
  });
});

// ── Vendor-neutral sections must reach every assistant ───────────────────────

/**
 * Sections that describe the architecture itself rather than how Claude Code
 * loads files. All four used to live only in `claude-addendum.md`, which left
 * Codex — and any future assistant — without the gateway rules, the
 * spawn-versus-gateway decision rule and the PRD write invariant. They now
 * live in `project-guidance.md`, so both surfaces carry them.
 *
 * If you are adding a section to `claude-addendum.md`, ask first whether it is
 * about Claude Code's own behaviour. If it describes the codebase, it belongs
 * in `project-guidance.md` instead.
 */
const VENDOR_NEUTRAL_SECTIONS = [
  "Monorepo-wide zone fragility governance",
  "Gateway modules",
  "Tier boundary crossing: spawn vs gateway",
  "Concurrency contract",
];

/**
 * Headings `claude-addendum.md` is allowed to own. Anything else in that file
 * is invisible to AGENTS.md, which is the drift this list exists to catch.
 */
const CLAUDE_ONLY_HEADINGS = ["Claude-specific guidance files"];

describe("vendor-neutral sections reach every assistant", () => {
  for (const heading of VENDOR_NEUTRAL_SECTIONS) {
    it(`"${heading}" lives in the shared guidance, not the Claude addendum`, () => {
      expect(
        getProjectGuidance(),
        `project-guidance.md is missing "${heading}"`,
      ).toContain(heading);
      expect(
        getClaudeAddendum(),
        `"${heading}" is vendor-neutral but sits in claude-addendum.md, so ` +
          `AGENTS.md never sees it. Move it into project-guidance.md.`,
      ).not.toContain(heading);
    });

    it(`both instruction files include "${heading}"`, () => {
      expect(claudeContent, `CLAUDE.md missing: ${heading}`).toContain(heading);
      expect(agentsContent, `AGENTS.md missing: ${heading}`).toContain(heading);
    });
  }

  it("claude-addendum.md owns only Claude-specific headings", () => {
    const headings = getClaudeAddendum()
      .split("\n")
      .filter((line) => /^#{2,6} /.test(line))
      .map((line) => line.replace(/^#+\s*/, "").trim());

    const unexpected = headings.filter((h) => !CLAUDE_ONLY_HEADINGS.includes(h));
    expect(
      unexpected,
      `claude-addendum.md renders into CLAUDE.md only. A section here is ` +
        `invisible to AGENTS.md. Move anything that describes the codebase ` +
        `into project-guidance.md, or add it to CLAUDE_ONLY_HEADINGS if it ` +
        `genuinely describes Claude Code's own behaviour.`,
    ).toEqual([]);
  });

  it("AGENTS.md never sends its reader to a package CLAUDE.md", () => {
    // Codex cannot load CLAUDE.md, and every package CLAUDE.md is now only an
    // @AGENTS.md import. A pointer at one — even a glob like
    // packages/*/CLAUDE.md — sends Codex to a file it will never read.
    expect(agentsContent).not.toMatch(/packages\/[^\s`]*\/CLAUDE\.md/);
  });

  it("AGENTS.md carries the gateway rules", () => {
    expect(agentsContent).toContain("One gateway per source package");
    expect(agentsContent).toContain("Re-export only");
    expect(agentsContent).toContain("Type imports through gateway");
    expect(agentsContent).toContain("New cross-package imports");
    // The gateway table itself, not just the rules.
    expect(agentsContent).toContain("src/prd/rex-gateway.ts");
    expect(agentsContent).toContain("src/server/domain-gateway.ts");
  });

  it("AGENTS.md carries the PRD write invariant", () => {
    expect(agentsContent).toContain("**PRD invariant.**");
    expect(agentsContent).toContain(
      "On v2 the only writable PRD roots are `product/` and `changes/`",
    );
    expect(agentsContent).toContain("Avoid parallel writers.");
  });
});

describe("Codex-specific content", () => {
  it("AGENTS.md includes Codex Troubleshooting", () => {
    expect(agentsContent).toContain("## Codex Troubleshooting");
    expect(agentsContent).toContain("Malformed Codex output");
    expect(agentsContent).toContain("Missing usage fields");
  });

  it("AGENTS.md includes manifest-derived Workflow section", () => {
    expect(agentsContent).toContain("## Workflow");
    expect(agentsContent).toContain(".rex/workflow.md");
    expect(agentsContent).toContain("get_next_task");
  });

  it("AGENTS.md includes Available Skills section", () => {
    expect(agentsContent).toContain("## Available Skills");
    expect(agentsContent).toContain(".agents/skills/");
  });

  it("AGENTS.md includes manifest-derived MCP tool reference", () => {
    expect(agentsContent).toContain("## MCP Servers");
    expect(agentsContent).toContain(".codex/config.toml");
  });

  it("AGENTS.md replaces shared MCP section with manifest-derived version", () => {
    // Should NOT contain the Claude MCP setup instructions
    expect(agentsContent).not.toContain("claude mcp add --transport http");
    // Should NOT contain the shared Development Workflow section
    expect(agentsContent).not.toContain("## Development Workflow");
  });
});

// ── Template source validation ───────────────────────────────────────────────

describe("template source validation", () => {
  it("project-guidance.md exists and is non-empty", () => {
    const guidance = getProjectGuidance();
    expect(guidance.length).toBeGreaterThan(0);
  });

  it("project-guidance.md contains ADDENDUM marker", () => {
    const guidance = getProjectGuidance();
    expect(guidance).toContain("<!-- ADDENDUM -->");
  });

  it("claude-addendum.md exists and is non-empty", () => {
    const addendum = getClaudeAddendum();
    expect(addendum.length).toBeGreaterThan(0);
  });

  it("codex-troubleshooting.md exists and is non-empty", () => {
    const ts = getCodexTroubleshooting();
    expect(ts.length).toBeGreaterThan(0);
  });

  it("ADDENDUM marker is not present in rendered CLAUDE.md", () => {
    expect(claudeContent).not.toContain("<!-- ADDENDUM -->");
  });

  it("ADDENDUM marker is not present in rendered AGENTS.md", () => {
    expect(agentsContent).not.toContain("<!-- ADDENDUM -->");
  });

  it("renderClaudeMd is idempotent", () => {
    expect(renderClaudeMd()).toBe(claudeContent);
  });

  it("renderAgentsMd is idempotent", () => {
    expect(renderAgentsMd()).toBe(agentsContent);
  });
});

// ── CODEX.md retirement ──────────────────────────────────────────────────────

describe("CODEX.md retirement", () => {
  it("CODEX.md no longer exists in the project root", () => {
    expect(existsSync(join(ROOT, "CODEX.md"))).toBe(false);
  });

  it("Codex Troubleshooting content has been preserved in AGENTS.md", () => {
    // The unique content that was in CODEX.md (troubleshooting) is now
    // sourced from codex-troubleshooting.md and included in AGENTS.md
    expect(agentsContent).toContain("normalizeCodexResponse");
    expect(agentsContent).toContain("mapCodexUsageToTokenUsage");
  });
});

// ── Init writes both instruction files ───────────────────────────────────────

describe("init writes both instruction files", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-instruction-alignment-"));
    setupAssistantIntegrations(tmpDir);
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes CLAUDE.md to project root", () => {
    expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
  });

  it("writes AGENTS.md to project root", () => {
    expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);
  });

  it("CLAUDE.md content matches renderClaudeMd() output", () => {
    const written = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(written).toBe(claudeContent);
  });

  it("AGENTS.md content matches renderAgentsMd() output", () => {
    const written = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");
    expect(written).toBe(agentsContent);
  });

  it("both files have generated-file headers", () => {
    const claude = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    const agents = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");
    expect(claude).toMatch(/^<!-- Generated by ndx init/);
    expect(agents).toMatch(/^<!-- Generated by ndx init/);
  });
});

// ── Package-level instruction surfaces ───────────────────────────────────────

/**
 * The root pair above is generated from one template, so it cannot drift. A
 * package's own guidance has no generator, and the same hazard applies in a
 * worse form: Codex and the other assistants read nested AGENTS.md files but
 * never CLAUDE.md, so a package note written only to CLAUDE.md is invisible to
 * most of the agents it governs — and one copied into both drifts the first
 * time someone edits the file they happened to open.
 *
 * So the rule is a pair, not a duplicate: the content lives in the package's
 * AGENTS.md and its CLAUDE.md is the Claude Code `@AGENTS.md` import of it.
 * See TESTING.md, "Co-evolution Rule: Seam Registry and Gateway Table".
 *
 * Every package CLAUDE.md is held to this, with no grandfathering: a CLAUDE.md
 * without an AGENTS.md beside it is guidance Codex cannot reach, which is the
 * whole failure this pairing exists to prevent.
 */
describe("package instruction surfaces", () => {
  const PACKAGES_DIR = join(ROOT, "packages");

  const withClaude = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      pkg: entry.name,
      claude: join(PACKAGES_DIR, entry.name, "CLAUDE.md"),
      agents: join(PACKAGES_DIR, entry.name, "AGENTS.md"),
    }))
    .filter(({ claude }) => existsSync(claude));

  it("llm-client keeps its guidance in AGENTS.md", () => {
    // Also guarantees the it.each blocks below are not vacuously empty.
    expect(withClaude.map(({ pkg }) => pkg)).toContain("llm-client");
  });

  it.each(withClaude)("packages/$pkg/CLAUDE.md has an AGENTS.md beside it", ({ agents }) => {
    expect(
      existsSync(agents),
      `a package CLAUDE.md with no AGENTS.md beside it is guidance only Claude ` +
        `Code can read. Move the content into AGENTS.md and reduce CLAUDE.md to ` +
        `the @AGENTS.md import — packages/llm-client/ is the reference pair.`,
    ).toBe(true);
  });

  it.each(withClaude)("packages/$pkg/CLAUDE.md imports AGENTS.md", ({ claude }) => {
    expect(readFileSync(claude, "utf-8")).toMatch(/^@AGENTS\.md$/m);
  });

  it.each(withClaude)("packages/$pkg/CLAUDE.md holds no guidance of its own", ({ claude }) => {
    const contents = readFileSync(claude, "utf-8");
    // A heading or a table row is content that was copied rather than imported,
    // which is the drift this pairing exists to prevent.
    expect(contents, "copied content, not an import").not.toMatch(/^\s*(#|\|)/m);
    const prose = contents
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("@"));
    expect(prose.length, prose.join("\n")).toBeLessThanOrEqual(1);
  });

  it("packages/llm-client/AGENTS.md holds the injection seam registry", () => {
    const agents = readFileSync(join(PACKAGES_DIR, "llm-client", "AGENTS.md"), "utf-8");
    expect(agents).toContain("## llm-client injection seam registry");
    expect(agents).toContain("JevObserver");
    expect(agents).toContain("## Judgment cache directory");
  });

  it("web and core keep their governance in AGENTS.md", () => {
    // Web's guidance is split by directory (PRD fabfa3a2): the package file
    // keeps a pointer section so a session rooted at packages/web still knows
    // the seams and the boundary exist, and the rules themselves sit beside the
    // code they govern. Both halves are AGENTS.md, so every assistant reads
    // whichever one its working directory puts on the chain.
    const web = readFileSync(join(PACKAGES_DIR, "web", "AGENTS.md"), "utf-8");
    expect(web).toContain("## Web injection seam registry");
    expect(web).toContain("## Web viewer gateway boundary");
    expect(web).toContain("RegisterSchedulerOptions");

    const server = readFileSync(
      join(PACKAGES_DIR, "web", "src", "server", "AGENTS.md"),
      "utf-8",
    );
    expect(server, "the seam table itself").toContain("| Injection site |");
    for (const iface of ["RegisterSchedulerOptions", "WorkspaceHooks", "LiveSources"]) {
      expect(server, `seam row for ${iface}`).toContain(iface);
    }

    const viewer = readFileSync(
      join(PACKAGES_DIR, "web", "src", "viewer", "AGENTS.md"),
      "utf-8",
    );
    expect(viewer).toContain("## Web viewer gateway boundary");
    expect(viewer).toContain("external.ts");

    const core = readFileSync(join(PACKAGES_DIR, "core", "AGENTS.md"), "utf-8");
    expect(core).toContain("## Core injection seam registry");
    expect(core).toContain("registerChild");
  });

  it("the Jev seam row names the function that registers the observer", () => {
    const agents = readFileSync(join(PACKAGES_DIR, "llm-client", "AGENTS.md"), "utf-8");
    const row = agents
      .split("\n")
      .find((line) => line.startsWith("| Jev per-call accounting"));
    expect(row, "seam registry row for the Jev observer").toBeDefined();
    expect(row).toContain("initAndLoadLLMConfig");

    // And that function is where `setJevObserver` is actually called — a row
    // naming a plausible-but-wrong site sends the next reader to a file that
    // does not register anything. Registering in `cmdAnalyze` instead would
    // drop `sv narrate`'s calls, so the distinction is load-bearing.
    const registrar = readFileSync(
      join(ROOT, "packages/sourcevision/src/cli/commands/analyze.ts"),
      "utf-8",
    );
    const body = registrar.slice(
      registrar.indexOf("export async function initAndLoadLLMConfig"),
    );
    const end = body.indexOf("\n}\n");
    expect(body.slice(0, end)).toContain("setJevObserver(");
  });
});

// ── Path-scoped rules stay pointers ──────────────────────────────────────────

/**
 * `.claude/rules/` is loaded by Claude Code and by nothing else, so a registry
 * kept there is out of Codex's reach for the same reason a package CLAUDE.md
 * is. The canonical copy of each one now sits in the owning package's
 * AGENTS.md.
 *
 * The rule files are now path-scoped pointers, so there is one copy of each
 * registry. The assertions below hold them that way, and they apply to every
 * file in the directory rather than to a fixed list: a new
 * `.claude/rules/rex-zone-policy.md` carrying a policy table is the same defect
 * as the two-copy state this replaced, and a name-based guard would miss it.
 */
describe("path-scoped injection seam rules", () => {
  const RULES_DIR = join(ROOT, ".claude/rules");

  /** The only two packages whose seam registry predates the AGENTS.md rule. */
  const ALLOWED_SEAM_RULES = ["core-injection-seams.md", "web-injection-seams.md"];

  const ruleFiles = readdirSync(RULES_DIR).filter((name) => name.endsWith(".md"));

  /**
   * The table rows of a Markdown document.
   *
   * Splits on `\r?\n`, not on a bare line feed. `.gitattributes` pins AGENTS.md
   * to LF but says nothing about `.claude/rules/`, so a Windows checkout with
   * `core.autocrlf=true` gets the rule files in CRLF. Splitting on `\n` alone
   * leaves a trailing `\r` on every row, which once made a row comparison fail
   * on Windows while it passed everywhere else. The fix belongs here rather
   * than in `.gitattributes`: this reads files it does not control the checkout
   * of, so it must cope with either line ending.
   */
  const rowsOf = (text) =>
    text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("| ") && !/^\|[\s|-]+\|$/.test(line));

  const seamRules = ruleFiles.filter((name) => name.endsWith("-injection-seams.md"));

  it("reads the same rows from a CRLF rule file as from an LF one", () => {
    // A Windows checkout hands this CRLF rule text, so a table row has to be
    // recognised as one regardless of line ending — otherwise the no-table
    // guard below passes vacuously on exactly the platform that needs it.
    const lf = ["# Seams", "", "| Target | Seam |", "|---|---|", "| a.js | registerChild |"].join(
      "\n",
    );
    const crlf = lf.replace(/\n/g, "\r\n");

    expect(rowsOf(crlf)).toEqual(rowsOf(lf));
    expect(rowsOf(crlf)).toEqual(["| Target | Seam |", "| a.js | registerChild |"]);
  });

  it("no package beyond core and web has a .claude/rules seam registry", () => {
    const unexpected = seamRules.filter((name) => !ALLOWED_SEAM_RULES.includes(name));
    expect(
      unexpected,
      `a seam registry in .claude/rules/ is invisible to Codex and every other ` +
        `assistant. Put a new package's registry in packages/<pkg>/AGENTS.md ` +
        `with its CLAUDE.md reduced to @AGENTS.md — packages/llm-client/ is the ` +
        `reference pair.`,
    ).toEqual([]);
  });

  it.each(ruleFiles)("%s carries no table of its own", (rule) => {
    // Whatever the file is named. A policy table here is readable by Claude
    // Code alone, so it is a second, divergent copy of something — or worse,
    // the only copy, which Codex never sees.
    expect(
      rowsOf(readFileSync(join(RULES_DIR, rule), "utf-8")),
      `.claude/rules/${rule} holds a table. .claude/ is read by Claude Code ` +
        `and nothing else, so this registry or policy is invisible to Codex ` +
        `and every other assistant. Move the table into the owning ` +
        `packages/<pkg>/AGENTS.md and leave a pointer here.`,
    ).toEqual([]);
  });

  it.each(ruleFiles)("%s points at an AGENTS.md section that exists", (rule) => {
    // A pointer has to name both halves — which AGENTS.md, and which section of
    // it — or renaming the section leaves it dangling with nothing to catch it.
    const text = readFileSync(join(RULES_DIR, rule), "utf-8");
    const title = text
      .split(/\r?\n/)
      .find((line) => line.startsWith("# "))
      ?.slice(2)
      .trim();
    expect(title, `.claude/rules/${rule} has no title heading`).toBeTruthy();

    const target = text.match(/packages\/[a-z-]+\/AGENTS\.md/)?.[0];
    expect(
      target,
      `.claude/rules/${rule} names no packages/<pkg>/AGENTS.md to point at. A ` +
        `rule file exists only for its paths: scoping — its body belongs in the ` +
        `owning package's AGENTS.md, which it must name.`,
    ).toBeTruthy();

    expect(
      readFileSync(join(ROOT, target), "utf-8"),
      `${target} has no "## ${title}" section for .claude/rules/${rule} to ` +
        `point at — either the section was renamed or the pointer is stale.`,
    ).toContain(`## ${title}`);
  });

  it.each(ruleFiles)("%s does not send a new package's registry back here", (rule) => {
    // The old files ended by telling authors to create an analogous
    // .claude/rules/<package>-injection-seams.md, which is how the
    // Claude-Code-only state reproduces itself.
    expect(
      readFileSync(join(RULES_DIR, rule), "utf-8"),
      `.claude/rules/${rule} tells authors to add another .claude/rules ` +
        `registry. A new package's registry goes in its own AGENTS.md with ` +
        `CLAUDE.md reduced to @AGENTS.md — packages/llm-client/ is the pair.`,
    ).not.toMatch(/<package>-injection-seams\.md/);
  });
});
