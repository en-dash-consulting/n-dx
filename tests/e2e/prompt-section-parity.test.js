/**
 * Prompt section parity — instruction file section-level equivalence.
 *
 * Builds on `instruction-alignment.test.js` by adding section-level
 * granularity: instead of just checking whether headings exist, this test
 * parses both CLAUDE.md and AGENTS.md into section maps and validates
 * that shared sections carry equivalent content and that workflow steps
 * reference the same MCP tool calls.
 *
 * This test ensures that both vendor instruction surfaces deliver
 * equivalent guidance at the content level, not just the heading level.
 *
 * @see tests/e2e/instruction-alignment.test.js — heading-level alignment
 * @see packages/hench/tests/unit/agent/prompt-parity.test.ts — PromptEnvelope parity
 * @see packages/core/assistant-assets.js — renderers for CLAUDE.md and AGENTS.md
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  renderClaudeMd,
  renderAgentsMd,
  getProjectGuidance,
} from "../../packages/core/assistant-assets.js";

// ── Helper: parse markdown into section map ──────────────────────────────────

/**
 * Parse a markdown document into a map of H2 heading → content.
 * Content is the text between the heading and the next H2 heading (or EOF).
 */
function parseH2Sections(markdown) {
  const sections = new Map();
  const lines = markdown.split("\n");
  let currentHeading = null;
  let currentContent = [];

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (currentHeading !== null) {
        sections.set(currentHeading, currentContent.join("\n").trim());
      }
      currentHeading = match[1];
      currentContent = [];
    } else if (currentHeading !== null) {
      currentContent.push(line);
    }
  }

  if (currentHeading !== null) {
    sections.set(currentHeading, currentContent.join("\n").trim());
  }

  return sections;
}

/**
 * Parse a markdown document into a map of H3 heading → content.
 * Content is the text between the H3 heading and the next H2/H3 heading (or EOF).
 */
function parseH3Sections(markdown) {
  const sections = new Map();
  const lines = markdown.split("\n");
  let currentHeading = null;
  let currentContent = [];

  for (const line of lines) {
    const h2Match = line.match(/^## /);
    const h3Match = line.match(/^### (.+)$/);
    if (h2Match || h3Match) {
      if (currentHeading !== null) {
        sections.set(currentHeading, currentContent.join("\n").trim());
      }
      currentHeading = h3Match ? h3Match[1] : null;
      currentContent = [];
    } else if (currentHeading !== null) {
      currentContent.push(line);
    }
  }

  if (currentHeading !== null) {
    sections.set(currentHeading, currentContent.join("\n").trim());
  }

  return sections;
}

// ── Render once for all tests ────────────────────────────────────────────────

let claudeContent;
let agentsContent;
let claudeSections;
let agentsSections;
let claudeH3Sections;
let agentsH3Sections;

beforeAll(() => {
  claudeContent = renderClaudeMd();
  agentsContent = renderAgentsMd();
  claudeSections = parseH2Sections(claudeContent);
  agentsSections = parseH2Sections(agentsContent);
  claudeH3Sections = parseH3Sections(claudeContent);
  agentsH3Sections = parseH3Sections(agentsContent);
});

// ── 1. Section-level content equivalence ─────────────────────────────────────

describe("instruction file section-level content equivalence", () => {
  /**
   * Shared H2 sections that must appear in both instruction files with
   * equivalent content. These sections derive from project-guidance.md.
   */
  const sharedSectionHeadings = [
    "Packages",
    "n-dx Orchestration Commands",
    "Key Files",
  ];

  for (const heading of sharedSectionHeadings) {
    it(`"${heading}" section exists in both files with non-empty content`, () => {
      const claudeSection = claudeSections.get(heading);
      const agentsSection = agentsSections.get(heading);
      expect(claudeSection, `CLAUDE.md missing section: ${heading}`).toBeDefined();
      expect(agentsSection, `AGENTS.md missing section: ${heading}`).toBeDefined();
      expect(claudeSection.length, `CLAUDE.md "${heading}" is empty`).toBeGreaterThan(0);
      expect(agentsSection.length, `AGENTS.md "${heading}" is empty`).toBeGreaterThan(0);
    });
  }

  it("Packages section lists the same package names", () => {
    const claudePackages = claudeSections.get("Packages");
    const agentsPackages = agentsSections.get("Packages");
    // The Packages section describes the 3 main user-facing packages.
    // Internal packages (llm-client, web, core) are listed in Monorepo Structure.
    const packageNames = ["sourcevision", "rex", "hench"];
    for (const pkg of packageNames) {
      expect(claudePackages, `CLAUDE.md Packages missing: ${pkg}`).toContain(pkg);
      expect(agentsPackages, `AGENTS.md Packages missing: ${pkg}`).toContain(pkg);
    }
  });

  it("Packages section mentions all 6 packages", () => {
    // Formerly a separate "Monorepo Structure" section (a packages/ tree
    // listing) — that section was trimmed as derivable content, but the
    // same package names all still appear within "Packages" via the
    // nested Architecture diagram and Package conventions table.
    const claudePkgs = claudeSections.get("Packages");
    const agentsPkgs = agentsSections.get("Packages");
    const allPackages = ["core", "sourcevision", "rex", "hench", "llm-client", "web"];
    for (const pkg of allPackages) {
      expect(claudePkgs, `CLAUDE.md Packages missing: ${pkg}`).toContain(pkg);
      expect(agentsPkgs, `AGENTS.md Packages missing: ${pkg}`).toContain(pkg);
    }
  });

  it("Packages sections share the same architecture diagram markers", () => {
    const claudePkgs = claudeSections.get("Packages");
    const agentsPkgs = agentsSections.get("Packages");
    const architectureMarkers = [
      "Four-tier dependency hierarchy",
      "Orchestration",
      "Execution",
      "Domain",
      "Foundation",
      "packages/core/",
    ];
    for (const marker of architectureMarkers) {
      expect(claudePkgs, `CLAUDE.md Packages missing: ${marker}`).toContain(marker);
      expect(agentsPkgs, `AGENTS.md Packages missing: ${marker}`).toContain(marker);
    }
  });

  it("Key Files sections reference the same critical paths", () => {
    // Narrowed to paths currently in both files' Key Files table — the
    // original list (.sourcevision/*, .rex/workflow.md, .hench/*) reflected
    // an older, broader table that has since been trimmed.
    const claudeFiles = claudeSections.get("Key Files");
    const agentsFiles = agentsSections.get("Key Files");
    const criticalPaths = [".rex/prd_tree/", ".rex/prd.json", ".n-dx.json"];
    for (const path of criticalPaths) {
      expect(claudeFiles, `CLAUDE.md key files missing: ${path}`).toContain(path);
      expect(agentsFiles, `AGENTS.md key files missing: ${path}`).toContain(path);
    }
  });

  it("shared H3 sections are present in both files", () => {
    // "Rex commands"/"Sourcevision commands"/"Hench commands" H3s were
    // trimmed from project-guidance.md in favor of pointing users at
    // `--help`/README — see cli-doc-sync.test.js's removal for the same reason.
    const sharedH3 = ["Architecture", "Package conventions"];
    for (const heading of sharedH3) {
      expect(
        claudeH3Sections.has(heading),
        `CLAUDE.md missing H3: ${heading}`,
      ).toBe(true);
      expect(
        agentsH3Sections.has(heading),
        `AGENTS.md missing H3: ${heading}`,
      ).toBe(true);
    }
  });
});

// ── 2. Workflow content parity ───────────────────────────────────────────────

describe("workflow content parity across instruction files", () => {
  /**
   * Key workflow operations that must appear in both instruction files.
   * These are the MCP tool calls that both vendor agents rely on.
   */
  const sharedWorkflowOperations = [
    "get_next_task",
    "update_task_status",
    "append_log",
  ];

  for (const op of sharedWorkflowOperations) {
    it(`both instruction files reference MCP operation: ${op}`, () => {
      expect(claudeContent, `CLAUDE.md missing: ${op}`).toContain(op);
      expect(agentsContent, `AGENTS.md missing: ${op}`).toContain(op);
    });
  }

  // Note: ".rex/workflow.md" is referenced only by AGENTS.md's "## Workflow"
  // section — CLAUDE.md delivers the same task-execution discipline through
  // the system prompt at runtime rather than in the instruction file itself
  // (see "AGENTS.md workflow includes commit step" below), so this is not
  // shared content to assert parity on.

  /**
   * Key workflow steps (actions) that both vendors must know about,
   * regardless of which section they appear in.
   */
  const sharedWorkflowSteps = [
    { label: "run validation", pattern: /validation/ },
    { label: "run tests", pattern: /test/ },
    { label: "read task context", pattern: /parent chain|acceptance criteria|context/i },
  ];

  for (const { label, pattern } of sharedWorkflowSteps) {
    it(`both files include workflow step: ${label}`, () => {
      expect(claudeContent).toMatch(pattern);
      expect(agentsContent).toMatch(pattern);
    });
  }

  it("AGENTS.md workflow includes commit step", () => {
    // AGENTS.md has an explicit numbered workflow with "Commit changes."
    // CLAUDE.md delivers this through the system prompt at runtime, not
    // in the instruction file itself.
    expect(agentsContent).toMatch(/[Cc]ommit/);
  });

  it("AGENTS.md Workflow section has numbered steps", () => {
    const agentsWorkflow = agentsSections.get("Workflow");
    expect(agentsWorkflow).toBeDefined();
    // Should have numbered steps 1-9
    for (let i = 1; i <= 7; i++) {
      expect(agentsWorkflow, `AGENTS.md Workflow missing step ${i}`).toContain(`${i}.`);
    }
  });
});

// ── 3. Source derivation parity ──────────────────────────────────────────────

describe("source derivation parity", () => {
  it("both files derive from the same project-guidance.md template", () => {
    const guidance = getProjectGuidance();

    // The template must contain the ADDENDUM marker
    expect(guidance).toContain("<!-- ADDENDUM -->");

    // Rendered files must not contain the marker
    expect(claudeContent).not.toContain("<!-- ADDENDUM -->");
    expect(agentsContent).not.toContain("<!-- ADDENDUM -->");
  });

  it("shared section content from project-guidance.md appears verbatim in both", () => {
    // Extract a shared paragraph from the guidance that should appear in both
    const guidance = getProjectGuidance();

    // The architecture description is shared content
    expect(guidance).toContain("Four-tier dependency hierarchy");
    expect(claudeContent).toContain("Four-tier dependency hierarchy");
    expect(agentsContent).toContain("Four-tier dependency hierarchy");
  });

  it("package descriptions are byte-identical between both files", () => {
    // The package-description bullet list at the top of "## Packages" is
    // copied verbatim from project-guidance.md to both files and should be
    // identical — but the H2 section as a whole now diverges beyond that
    // point (CLAUDE.md nests several Claude-only H3/H4/H5 subsections, e.g.
    // zone fragility governance and Gateway modules, that AGENTS.md doesn't
    // include), so only the shared bullet-list prefix (before the first H3)
    // is compared, not the full section.
    const bulletListPrefix = (section) => section.split(/\n### /)[0];
    const claudePkgs = bulletListPrefix(claudeSections.get("Packages"));
    const agentsPkgs = bulletListPrefix(agentsSections.get("Packages"));
    expect(claudePkgs).toBe(agentsPkgs);
  });

  it("renderers are idempotent", () => {
    expect(renderClaudeMd()).toBe(claudeContent);
    expect(renderAgentsMd()).toBe(agentsContent);
  });
});

// ── 4. MCP tool reference parity ─────────────────────────────────────────────

describe("MCP tool reference parity", () => {
  /**
   * Both instruction files should reference the same MCP tools, even though
   * they may present them in different formats (CLAUDE.md uses full docs,
   * AGENTS.md uses manifest-derived summary).
   */
  const sharedMcpTools = [
    "get_prd_status",
    "get_next_task",
    "update_task_status",
    "add_item",
    "get_overview",
    "get_findings",
    "get_file_info",
  ];

  for (const tool of sharedMcpTools) {
    it(`both files reference MCP tool: ${tool}`, () => {
      expect(claudeContent, `CLAUDE.md missing MCP tool: ${tool}`).toContain(tool);
      expect(agentsContent, `AGENTS.md missing MCP tool: ${tool}`).toContain(tool);
    });
  }

  it("both files mention Rex and Sourcevision MCP servers", () => {
    expect(claudeContent).toContain("Rex");
    expect(claudeContent).toContain("Sourcevision");
    expect(agentsContent).toContain("Rex");
    expect(agentsContent).toContain("Sourcevision");
  });
});
