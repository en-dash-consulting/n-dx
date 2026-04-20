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
import { existsSync, mkdtempSync, rmSync, readFileSync } from "fs";
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
    "## Monorepo Structure",
    "### Architecture",
    "### Package conventions",
    "## Command Aliases",
    "## n-dx Orchestration Commands",
    "## Direct Tool Access",
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
    const commands = [
      "ndx init",
      "ndx plan",
      "ndx work",
      "ndx status",
      "ndx start",
    ];
    for (const cmd of commands) {
      expect(claudeContent, `CLAUDE.md missing cmd: ${cmd}`).toContain(cmd);
      expect(agentsContent, `AGENTS.md missing cmd: ${cmd}`).toContain(cmd);
    }
  });

  it("both files include the same key files", () => {
    const keyFiles = [
      ".sourcevision/CONTEXT.md",
      ".rex/prd.json",
      ".rex/workflow.md",
      ".hench/config.json",
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

  it("CLAUDE.md includes Injection seam registry", () => {
    expect(claudeContent).toContain("### Injection seam registry");
  });

  it("CLAUDE.md includes Concurrency contract", () => {
    expect(claudeContent).toContain("### Concurrency contract");
  });

  it("CLAUDE.md includes MCP Servers section", () => {
    expect(claudeContent).toContain("## MCP Servers");
  });

  it("CLAUDE.md includes Development Workflow section", () => {
    expect(claudeContent).toContain("## Development Workflow");
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
