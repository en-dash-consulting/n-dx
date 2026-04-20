/**
 * Codex artifact validation — exhaustive structural and consistency checks
 * for all artifacts generated during `ndx init` for the Codex assistant.
 *
 * These tests protect against:
 *   1. Path drift — manifest vendor targets must match actual disk locations
 *   2. Missing skills — every manifest skill must appear on disk and in AGENTS.md
 *   3. Malformed MCP definitions — config.toml structure must be parseable and complete
 *   4. Cross-artifact consistency — AGENTS.md, skill files, and config.toml must agree
 *   5. Format stability — artifact structures must not regress between runs
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getManifest,
  getMcpServers,
  getSkillNames,
  getVendorTarget,
  listSkillFiles,
} from "../../packages/core/assistant-assets.js";
import { setupCodexIntegration } from "../../packages/core/codex-integration.js";

// ── Shared setup: generate all artifacts once ───────────────────────────────

let tmpDir;
let tomlContent;
let agentsContent;
let skillFiles;  // Map<skillName, fileContent>

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ndx-codex-artifact-validation-"));
  setupCodexIntegration(tmpDir);

  tomlContent = readFileSync(join(tmpDir, ".codex", "config.toml"), "utf-8");
  agentsContent = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");

  skillFiles = new Map();
  const skillsDir = join(tmpDir, ".agents", "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillPath = join(skillsDir, entry.name, "SKILL.md");
        if (existsSync(skillPath)) {
          skillFiles.set(entry.name, readFileSync(skillPath, "utf-8"));
        }
      }
    }
  }
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ── Path drift: manifest vendor targets vs. actual disk ─────────────────────

describe("path drift protection", () => {
  const codexTarget = getVendorTarget("codex");

  it("manifest skillDir matches actual .agents/skills location", () => {
    expect(codexTarget.skillDir).toBe(".agents/skills");
    expect(existsSync(join(tmpDir, codexTarget.skillDir))).toBe(true);
  });

  it("manifest skillFile matches actual SKILL.md filename", () => {
    expect(codexTarget.skillFile).toBe("SKILL.md");
    // Verify at least one skill uses this filename
    const firstSkill = getSkillNames()[0];
    expect(
      existsSync(join(tmpDir, codexTarget.skillDir, firstSkill, codexTarget.skillFile)),
    ).toBe(true);
  });

  it("manifest instructionFile matches actual AGENTS.md filename", () => {
    expect(codexTarget.instructionFile).toBe("AGENTS.md");
    expect(existsSync(join(tmpDir, codexTarget.instructionFile))).toBe(true);
  });

  it("config.toml lives at .codex/config.toml (no path variation)", () => {
    expect(existsSync(join(tmpDir, ".codex", "config.toml"))).toBe(true);
  });

  it("no unexpected files in .codex/ directory", () => {
    const codexFiles = readdirSync(join(tmpDir, ".codex"));
    expect(codexFiles).toEqual(["config.toml"]);
  });

  it("no unexpected files in skill directories", () => {
    const skillNames = getSkillNames();
    for (const name of skillNames) {
      const dir = join(tmpDir, codexTarget.skillDir, name);
      const files = readdirSync(dir);
      expect(files).toEqual([codexTarget.skillFile]);
    }
  });
});

// ── Missing skills: manifest skills vs. disk skills ─────────────────────────

describe("skill completeness", () => {
  const manifestSkills = getSkillNames();

  it("every manifest skill has a directory on disk", () => {
    for (const name of manifestSkills) {
      expect(skillFiles.has(name)).toBe(true);
    }
  });

  it("no extra skill directories beyond manifest", () => {
    const diskSkills = [...skillFiles.keys()].sort();
    const expected = [...manifestSkills].sort();
    expect(diskSkills).toEqual(expected);
  });

  it("every manifest skill has a corresponding body file in assistant-assets/skills/", () => {
    const assetSkills = listSkillFiles().sort();
    const expected = [...manifestSkills].sort();
    expect(assetSkills).toEqual(expected);
  });

  it("skill files are non-empty", () => {
    for (const [name, content] of skillFiles) {
      expect(content.length, `Skill ${name} body is empty`).toBeGreaterThan(0);
    }
  });

  it("skill files use YAML frontmatter wrapper", () => {
    for (const [name, content] of skillFiles) {
      expect(content, `Skill ${name} is missing YAML frontmatter`).toMatch(/^---\n/);
    }
  });

  it("AGENTS.md lists every manifest skill", () => {
    for (const name of manifestSkills) {
      expect(
        agentsContent,
        `AGENTS.md missing skill: ${name}`,
      ).toContain(`**${name}**`);
    }
  });
});

// ── Malformed MCP definitions: config.toml structural validity ──────────────

describe("config.toml structural validity", () => {
  const servers = getMcpServers();
  const serverNames = Object.keys(servers);

  /**
   * Parse TOML sections into a map of section name -> key/value pairs.
   * This is a minimal parser sufficient for the generated config format.
   */
  function parseTomlSections(content) {
    const sections = new Map();
    let currentSection = null;

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const sectionMatch = trimmed.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        sections.set(currentSection, {});
        continue;
      }

      if (currentSection) {
        const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
        if (kvMatch) {
          sections.get(currentSection)[kvMatch[1]] = kvMatch[2];
        }
      }
    }

    return sections;
  }

  it("has exactly one section per manifest MCP server", () => {
    const sections = parseTomlSections(tomlContent);
    const mcpSections = [...sections.keys()].filter((k) => k.startsWith("mcp_servers."));

    expect(mcpSections.length).toBe(serverNames.length);
    for (const name of serverNames) {
      expect(mcpSections).toContain(`mcp_servers.${name}`);
    }
  });

  it("no extra MCP server sections beyond manifest", () => {
    const sections = parseTomlSections(tomlContent);
    const mcpSections = [...sections.keys()].filter((k) => k.startsWith("mcp_servers."));
    const expectedSections = serverNames.map((n) => `mcp_servers.${n}`).sort();
    expect(mcpSections.sort()).toEqual(expectedSections);
  });

  it("every server section has command and args keys", () => {
    const sections = parseTomlSections(tomlContent);
    for (const name of serverNames) {
      const section = sections.get(`mcp_servers.${name}`);
      expect(section, `Missing section for ${name}`).toBeDefined();
      expect(section.command, `${name} missing command`).toBeDefined();
      expect(section.args, `${name} missing args`).toBeDefined();
    }
  });

  it("every server uses command = \"node\"", () => {
    const sections = parseTomlSections(tomlContent);
    for (const name of serverNames) {
      const section = sections.get(`mcp_servers.${name}`);
      expect(section.command).toBe('"node"');
    }
  });

  it("every server args is a valid 3-element TOML array", () => {
    const sections = parseTomlSections(tomlContent);
    for (const name of serverNames) {
      const section = sections.get(`mcp_servers.${name}`);
      // args should be: ["<entrypoint>", "<mcp-command>", "<project-dir>"]
      const argsMatch = section.args.match(/^\[(.+)\]$/);
      expect(argsMatch, `${name} args is not a TOML array`).not.toBeNull();

      // Split by ", " and count elements (quoted strings)
      const elements = argsMatch[1].match(/"[^"]*"/g);
      expect(elements, `${name} args elements not parseable`).not.toBeNull();
      expect(elements.length, `${name} args should have 3 elements`).toBe(3);
    }
  });

  it("every server args[0] ends with dist/cli/index.js (entrypoint)", () => {
    const sections = parseTomlSections(tomlContent);
    for (const name of serverNames) {
      const section = sections.get(`mcp_servers.${name}`);
      const elements = section.args.match(/^\[(.+)\]$/)[1].match(/"([^"]*)"/g);
      const entrypoint = elements[0].slice(1, -1); // strip quotes
      expect(entrypoint, `${name} entrypoint path`).toMatch(/dist[/\\]cli[/\\]index\.js$/);
    }
  });

  it("every server args[1] matches manifest mcpCommand", () => {
    const sections = parseTomlSections(tomlContent);
    for (const name of serverNames) {
      const section = sections.get(`mcp_servers.${name}`);
      const elements = section.args.match(/^\[(.+)\]$/)[1].match(/"([^"]*)"/g);
      const mcpCommand = elements[1].slice(1, -1);
      expect(mcpCommand).toBe(servers[name].mcpCommand);
    }
  });

  it("every server args[2] is the project directory", () => {
    const sections = parseTomlSections(tomlContent);
    for (const name of serverNames) {
      const section = sections.get(`mcp_servers.${name}`);
      const elements = section.args.match(/^\[(.+)\]$/)[1].match(/"([^"]*)"/g);
      const projectDir = elements[2].slice(1, -1);
      expect(projectDir).toBe(tmpDir);
    }
  });

  it("no sandbox, approval, or model configuration keys", () => {
    // config.toml should only contain MCP server definitions
    expect(tomlContent).not.toContain("sandbox");
    expect(tomlContent).not.toContain("approval");
    expect(tomlContent).not.toContain("model");
  });

  it("starts with generated-file header", () => {
    expect(tomlContent).toMatch(/^# Generated by ndx init/);
    expect(tomlContent).toContain("do not edit manually");
  });

  it("contains no url or http references (stdio only)", () => {
    expect(tomlContent).not.toContain("url =");
    expect(tomlContent).not.toContain("http://");
    expect(tomlContent).not.toContain("https://");
  });
});

// ── AGENTS.md format stability ──────────────────────────────────────────────

describe("AGENTS.md format stability", () => {
  // Shared guidance sections come first, then manifest-derived operational sections
  const expectedSections = [
    "# n-dx",
    "## Packages",
    "## Monorepo Structure",
    "## Command Aliases",
    "## n-dx Orchestration Commands",
    "## Direct Tool Access",
    "## Key Files",
    "## Workflow",
    "## Available Skills",
    "## MCP Servers",
    "## When to Use Each Server",
    "## Codex Troubleshooting",
  ];

  it("contains all required sections in order", () => {
    let lastIndex = -1;
    for (const heading of expectedSections) {
      const index = agentsContent.indexOf(heading);
      expect(index, `Missing section: ${heading}`).toBeGreaterThan(-1);
      expect(index, `Section "${heading}" out of order`).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
  });

  it("has a generated-file header comment", () => {
    expect(agentsContent).toMatch(/^<!-- Generated by ndx init/);
    expect(agentsContent).toContain("do not edit manually");
  });

  it("includes shared project guidance (Packages, Architecture)", () => {
    expect(agentsContent).toContain("sourcevision");
    expect(agentsContent).toContain("rex");
    expect(agentsContent).toContain("hench");
    expect(agentsContent).toContain("Four-tier dependency hierarchy");
  });

  it("excludes Claude-specific deep sections", () => {
    expect(agentsContent).not.toContain("zone fragility governance");
    expect(agentsContent).not.toContain("Injection seam registry");
    expect(agentsContent).not.toContain("Concurrency contract");
  });

  it("workflow section references .rex/workflow.md", () => {
    expect(agentsContent).toContain(".rex/workflow.md");
  });

  it("workflow section references core rex MCP tools", () => {
    expect(agentsContent).toContain("get_next_task");
    expect(agentsContent).toContain("update_task_status");
    expect(agentsContent).toContain("append_log");
  });

  it("has per-server subsections under MCP Servers", () => {
    const serverNames = Object.keys(getMcpServers());
    for (const name of serverNames) {
      expect(agentsContent).toContain(`### ${name}`);
    }
  });

  it("uses bare tool names (no mcp__ prefix)", () => {
    expect(agentsContent).not.toContain("mcp__");
  });

  it("references .agents/skills/ and .codex/config.toml", () => {
    expect(agentsContent).toContain(".agents/skills/");
    expect(agentsContent).toContain(".codex/config.toml");
  });

  it("includes Codex Troubleshooting section", () => {
    expect(agentsContent).toContain("## Codex Troubleshooting");
    expect(agentsContent).toContain("Malformed Codex output");
    expect(agentsContent).toContain("Missing usage fields");
  });
});

// ── Cross-artifact consistency ──────────────────────────────────────────────

describe("cross-artifact consistency", () => {
  const manifest = getManifest();
  const servers = manifest.mcpServers;
  const skills = manifest.skills;

  it("every MCP read tool in manifest appears in AGENTS.md", () => {
    for (const [serverName, descriptor] of Object.entries(servers)) {
      for (const tool of descriptor.tools.read) {
        expect(
          agentsContent,
          `AGENTS.md missing read tool ${tool} from ${serverName}`,
        ).toContain(`\`${tool}\``);
      }
    }
  });

  it("every MCP write tool in manifest appears in AGENTS.md", () => {
    for (const [serverName, descriptor] of Object.entries(servers)) {
      for (const tool of descriptor.tools.write) {
        expect(
          agentsContent,
          `AGENTS.md missing write tool ${tool} from ${serverName}`,
        ).toContain(`\`${tool}\``);
      }
    }
  });

  it("every MCP server in config.toml is referenced in AGENTS.md", () => {
    const serverNames = Object.keys(servers);
    for (const name of serverNames) {
      expect(tomlContent).toContain(`[mcp_servers.${name}]`);
      expect(agentsContent).toContain(`### ${name}`);
    }
  });

  it("skill names in AGENTS.md match skill directories on disk", () => {
    const diskSkillNames = [...skillFiles.keys()].sort();
    const manifestSkillNames = Object.keys(skills).sort();

    // All disk skills should be mentioned in AGENTS.md
    for (const name of diskSkillNames) {
      expect(agentsContent).toContain(`**${name}**`);
    }

    // Manifest and disk should be identical
    expect(diskSkillNames).toEqual(manifestSkillNames);
  });

  it("skill descriptions in AGENTS.md match manifest", () => {
    for (const [name, meta] of Object.entries(skills)) {
      expect(
        agentsContent,
        `AGENTS.md description mismatch for ${name}`,
      ).toContain(meta.description);
    }
  });

  it("manifest MCP server count matches config.toml section count", () => {
    const manifestCount = Object.keys(servers).length;
    const tomlSections = tomlContent.match(/\[mcp_servers\.\w+\]/g) ?? [];
    expect(tomlSections.length).toBe(manifestCount);
  });

  it("manifest skill count matches disk skill count", () => {
    expect(skillFiles.size).toBe(Object.keys(skills).length);
  });
});

// ── Artifact regeneration stability ─────────────────────────────────────────

describe("artifact regeneration stability", () => {
  it("regenerating produces identical artifacts", () => {
    const secondDir = mkdtempSync(join(tmpdir(), "ndx-codex-artifact-regen-"));
    try {
      setupCodexIntegration(secondDir);

      const secondToml = readFileSync(join(secondDir, ".codex", "config.toml"), "utf-8");
      const secondAgents = readFileSync(join(secondDir, "AGENTS.md"), "utf-8");

      // AGENTS.md should be identical (path-independent)
      expect(secondAgents).toBe(agentsContent);

      // config.toml structure should match (paths differ due to tmpdir)
      // Compare section headers and key names
      const extractStructure = (content) =>
        content
          .split("\n")
          .filter((l) => l.match(/^\[/) || l.match(/^\w+\s*=/))
          .map((l) => l.replace(/"[^"]*"/g, '"..."'))
          .join("\n");

      expect(extractStructure(secondToml)).toBe(extractStructure(tomlContent));
    } finally {
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("overwriting existing artifacts produces identical output", () => {
    // Run setup twice in the same directory
    setupCodexIntegration(tmpDir);
    const overwrittenToml = readFileSync(join(tmpDir, ".codex", "config.toml"), "utf-8");
    const overwrittenAgents = readFileSync(join(tmpDir, "AGENTS.md"), "utf-8");

    expect(overwrittenToml).toBe(tomlContent);
    expect(overwrittenAgents).toBe(agentsContent);
  });
});
