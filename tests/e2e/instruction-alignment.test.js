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

// ── Vendor-specific content ──────────────────────────────────────────────────

describe("Claude-specific content", () => {
  it("CLAUDE.md includes injection seam registry references", () => {
    // The inline "### Injection seam registry" section was later replaced by
    // a pointer sentence to the path-scoped rule files that now hold this
    // content (.claude/rules/*-injection-seams.md) — check for those instead.
    expect(claudeContent).toContain(".claude/rules/web-injection-seams.md");
    expect(claudeContent).toContain(".claude/rules/core-injection-seams.md");
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
      "The sole writable PRD surface is the folder tree",
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
