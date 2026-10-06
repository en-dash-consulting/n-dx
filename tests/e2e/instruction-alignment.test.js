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
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync, readdirSync } from "fs";
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

  it("both files include the web zone layering", () => {
    const zoneMarker = "web-server";
    expect(claudeContent).toContain(zoneMarker);
    expect(agentsContent).toContain(zoneMarker);
  });

  it("both files list the same orchestration commands", () => {
    // "ndx plan"/"ndx status"/"ndx start" only appear in CLAUDE.md's
    // Claude-only Concurrency contract section — narrowed to the commands
    // that genuinely appear in the shared project-guidance.md prose (the
    // "Assistant Instruction Files" intro and the "ndx work" Gotcha note).
    const commands = ["ndx init", "ndx work"];
    for (const cmd of commands) {
      expect(claudeContent, `CLAUDE.md missing cmd: ${cmd}`).toContain(cmd);
      expect(agentsContent, `AGENTS.md missing cmd: ${cmd}`).toContain(cmd);
    }
  });

  it("both files include the same key files", () => {
    // ".rex/workflow.md" (Codex-only Workflow section) and
    // ".hench/config.json" (Claude-only Spawn-exempt/Concurrency notes)
    // each appear in only one file by design — narrowed to paths genuinely
    // shared between both.
    const keyFiles = [
      ".sourcevision/CONTEXT.md",
      ".rex/prd.json",
      ".n-dx.json",
    ];
    for (const file of keyFiles) {
      expect(claudeContent, `CLAUDE.md missing: ${file}`).toContain(file);
      expect(agentsContent, `AGENTS.md missing: ${file}`).toContain(file);
    }
  });
});

// ── Vendor-specific content ──────────────────────────────────────────────────

describe("Claude-specific content", () => {
  it("CLAUDE.md includes zone fragility governance", () => {
    expect(claudeContent).toContain("zone fragility governance");
  });

  it("CLAUDE.md includes Gateway modules detail", () => {
    expect(claudeContent).toContain("### Gateway modules");
  });

  it("CLAUDE.md includes injection seam registry references", () => {
    // The inline "### Injection seam registry" section was later replaced by
    // a pointer sentence to the path-scoped rule files that now hold this
    // content (.claude/rules/*-injection-seams.md) — check for those instead.
    expect(claudeContent).toContain(".claude/rules/web-injection-seams.md");
    expect(claudeContent).toContain(".claude/rules/core-injection-seams.md");
  });

  it("CLAUDE.md includes Concurrency contract", () => {
    expect(claudeContent).toContain("### Concurrency contract");
  });

  it("CLAUDE.md includes MCP Servers section", () => {
    expect(claudeContent).toContain("## MCP Servers");
  });

  it("CLAUDE.md does NOT include Codex Troubleshooting", () => {
    expect(claudeContent).not.toContain("## Codex Troubleshooting");
  });

  it("AGENTS.md does NOT include Claude-specific deep sections", () => {
    expect(agentsContent).not.toContain("zone fragility governance");
    expect(agentsContent).not.toContain("Injection seam registry");
    expect(agentsContent).not.toContain("Concurrency contract");
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
 * Packages whose CLAUDE.md predates the rule and have no AGENTS.md beside it
 * are not failed here — the rule binds the pair, not the pace of migration.
 */
describe("package instruction surfaces", () => {
  const PACKAGES_DIR = join(ROOT, "packages");

  const paired = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      pkg: entry.name,
      claude: join(PACKAGES_DIR, entry.name, "CLAUDE.md"),
      agents: join(PACKAGES_DIR, entry.name, "AGENTS.md"),
    }))
    .filter(({ claude, agents }) => existsSync(claude) && existsSync(agents));

  it("llm-client keeps its guidance in AGENTS.md", () => {
    // Also guarantees the it.each blocks below are not vacuously empty.
    expect(paired.map(({ pkg }) => pkg)).toContain("llm-client");
  });

  it.each(paired)("packages/$pkg/CLAUDE.md imports AGENTS.md", ({ claude }) => {
    expect(readFileSync(claude, "utf-8")).toMatch(/^@AGENTS\.md$/m);
  });

  it.each(paired)("packages/$pkg/CLAUDE.md holds no guidance of its own", ({ claude }) => {
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
