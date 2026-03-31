/**
 * Validates that the assistant asset manifest is well-formed and that skill
 * definitions stay in sync across three locations:
 *
 *   1. `assistant-assets/` — the vendor-neutral canonical source
 *      (manifest.json + skills/*.md)
 *   2. `.claude/skills/` — the Claude Code output
 *      (rendered from assistant-assets/ via renderSkill)
 *   3. `claude-integration.js` — the init module that writes (2)
 *      (must import from assistant-assets/, not define skills inline)
 *
 * When a skill is added, renamed, or modified in one place but not the
 * others, these tests fail with a diff showing what's out of sync.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import {
  getManifest,
  getRegistry,
  getSkillNames,
  getSkillBody,
  listSkillFiles,
  getMcpServers,
  getMcpServer,
  getVendors,
  getVendorTarget,
  getToolIds,
  getAutoApprovedToolIds,
  renderSkill,
  renderAllSkills,
  renderClaudeSkill,
  renderAllClaudeSkills,
} from "../../assistant-assets/index.js";

const ROOT = join(import.meta.dirname, "../..");

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize whitespace so trivial formatting differences don't break sync. */
const normalize = (s) =>
  s.replace(/\u2192/g, "->").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();

/**
 * Read all local Claude skill files from .claude/skills/.
 * Returns a Map of skill name -> content string.
 */
function readClaudeSkills() {
  const skillsDir = join(ROOT, ".claude", "skills");
  if (!existsSync(skillsDir)) return new Map();

  const skills = new Map();
  for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillFile = join(skillsDir, dir.name, "SKILL.md");
    if (existsSync(skillFile)) {
      skills.set(dir.name, readFileSync(skillFile, "utf-8").trim());
    }
  }

  return skills;
}

// ── Manifest structure validation ───────────────────────────────────────────

describe("assistant-assets manifest structure", () => {
  const manifest = getManifest();

  it("manifest has required top-level keys", () => {
    expect(manifest).toHaveProperty("skills");
    expect(manifest).toHaveProperty("mcpServers");
    expect(manifest).toHaveProperty("vendors");
  });

  it("skills section has at least one entry", () => {
    expect(Object.keys(manifest.skills).length).toBeGreaterThan(0);
  });

  it("every skill has a non-empty description", () => {
    const bad = Object.entries(manifest.skills)
      .filter(([, meta]) => !meta.description || meta.description.trim() === "")
      .map(([name]) => name);
    if (bad.length > 0) {
      expect.fail(`Skills missing description: ${bad.join(", ")}`);
    }
  });

  it("every skill body file exists and is non-empty", () => {
    const empty = [];
    for (const name of getSkillNames()) {
      const body = getSkillBody(name);
      if (body.trim().length === 0) {
        empty.push(name);
      }
    }
    if (empty.length > 0) {
      expect.fail(`Empty skill bodies: ${empty.join(", ")}`);
    }
  });

  it("every skill file has a manifest entry", () => {
    const fileNames = listSkillFiles();
    const missing = fileNames.filter((f) => !manifest.skills[f]);
    if (missing.length > 0) {
      expect.fail(
        `Skill files without manifest entries: ${missing.join(", ")}\n` +
        "Add entries to assistant-assets/manifest.json.",
      );
    }
  });

  it("every manifest skill entry has a corresponding skill file", () => {
    const fileNames = listSkillFiles();
    const missing = Object.keys(manifest.skills).filter((n) => !fileNames.includes(n));
    if (missing.length > 0) {
      expect.fail(
        `Manifest entries without skill files: ${missing.join(", ")}\n` +
        "Create matching assistant-assets/skills/<name>.md files.",
      );
    }
  });
});

describe("manifest MCP server descriptors", () => {
  const servers = getMcpServers();
  const serverNames = Object.keys(servers);

  it("manifest defines at least one MCP server", () => {
    expect(serverNames.length).toBeGreaterThan(0);
  });

  for (const name of serverNames) {
    describe(`server "${name}"`, () => {
      const desc = servers[name];

      it("has required fields", () => {
        expect(desc).toHaveProperty("package");
        expect(desc).toHaveProperty("npmName");
        expect(desc).toHaveProperty("entrypoint");
        expect(desc).toHaveProperty("mcpCommand");
        expect(desc).toHaveProperty("tools");
        expect(desc.tools).toHaveProperty("read");
        expect(desc.tools).toHaveProperty("write");
      });

      it("package directory exists", () => {
        const pkgDir = join(ROOT, desc.package);
        expect(existsSync(pkgDir)).toBe(true);
      });

      it("entrypoint file exists after build", () => {
        const entry = join(ROOT, desc.package, desc.entrypoint);
        // This file exists only after build, so skip if not built
        if (!existsSync(entry)) {
          return; // gracefully skip pre-build
        }
        expect(existsSync(entry)).toBe(true);
      });

      it("read tools array is non-empty", () => {
        expect(desc.tools.read.length).toBeGreaterThan(0);
      });

      it("no tool appears in both read and write lists", () => {
        const overlap = desc.tools.read.filter((t) => desc.tools.write.includes(t));
        if (overlap.length > 0) {
          expect.fail(
            `Tools in both read and write for "${name}": ${overlap.join(", ")}`,
          );
        }
      });
    });
  }
});

describe("manifest vendor delivery targets", () => {
  const vendors = getVendors();
  const vendorIds = Object.keys(vendors);

  it("manifest defines both claude and codex vendors", () => {
    expect(vendorIds).toContain("claude");
    expect(vendorIds).toContain("codex");
  });

  for (const id of vendorIds) {
    describe(`vendor "${id}"`, () => {
      const target = vendors[id];

      it("has required fields", () => {
        expect(target).toHaveProperty("skillDir");
        expect(target).toHaveProperty("skillFile");
        expect(target).toHaveProperty("skillWrapper");
        expect(target).toHaveProperty("instructionFile");
        expect(target).toHaveProperty("toolPrefix");
      });

      it("skillWrapper is a known format", () => {
        expect(["yaml-frontmatter", "plain"]).toContain(target.skillWrapper);
      });
    });
  }
});

// ── Render contract ─────────────────────────────────────────────────────────

describe("render contract", () => {
  const skillNames = getSkillNames();

  describe("renderSkill dispatches by vendor", () => {
    for (const name of skillNames) {
      it(`"${name}" renders for claude (yaml-frontmatter)`, () => {
        const content = renderSkill(name, "claude");
        expect(content).toMatch(/^---\n/);
        expect(content).toContain(`name: ${name}`);
        expect(content).toContain("description:");
        expect(content).toMatch(/---\n\n/);
      });

      it(`"${name}" renders for codex (plain body)`, () => {
        const content = renderSkill(name, "codex");
        const body = getSkillBody(name);
        expect(content).toBe(body);
        // Plain wrapper means no YAML frontmatter
        expect(content).not.toMatch(/^---\n/);
      });
    }
  });

  it("renderAllSkills covers all registered skills", () => {
    for (const vendor of ["claude", "codex"]) {
      const rendered = renderAllSkills(vendor);
      expect(Object.keys(rendered).sort()).toEqual([...skillNames].sort());
    }
  });

  it("renderClaudeSkill is equivalent to renderSkill(name, 'claude')", () => {
    for (const name of skillNames) {
      expect(renderClaudeSkill(name)).toBe(renderSkill(name, "claude"));
    }
  });

  it("renderAllClaudeSkills is equivalent to renderAllSkills('claude')", () => {
    const a = renderAllClaudeSkills();
    const b = renderAllSkills("claude");
    expect(a).toEqual(b);
  });
});

// ── Tool ID derivation ──────────────────────────────────────────────────────

describe("tool ID derivation", () => {
  it("claude read tools are prefixed with mcp__{server}__", () => {
    const ids = getAutoApprovedToolIds("claude");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^mcp__(rex|sourcevision)__/);
    }
  });

  it("claude write tools are prefixed with mcp__{server}__", () => {
    const ids = getToolIds("claude", "write");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^mcp__(rex|sourcevision)__/);
    }
  });

  it("codex tools have no prefix (toolPrefix is null)", () => {
    const ids = getAutoApprovedToolIds("codex");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).not.toContain("mcp__");
    }
  });

  it("read and write tool IDs do not overlap for any vendor", () => {
    for (const vendor of ["claude", "codex"]) {
      const read = new Set(getToolIds(vendor, "read"));
      const write = getToolIds(vendor, "write");
      const overlap = write.filter((t) => read.has(t));
      if (overlap.length > 0) {
        expect.fail(
          `Overlapping read/write tool IDs for "${vendor}": ${overlap.join(", ")}`,
        );
      }
    }
  });
});

// ── Backward compatibility ──────────────────────────────────────────────────

describe("backward compatibility", () => {
  it("getRegistry() returns { skills } subset of manifest", () => {
    const registry = getRegistry();
    expect(registry).toHaveProperty("skills");
    expect(registry.skills).toEqual(getManifest().skills);
  });

  it("getMcpServer() throws for unknown server", () => {
    expect(() => getMcpServer("nonexistent")).toThrow("not in manifest");
  });

  it("getVendorTarget() throws for unknown vendor", () => {
    expect(() => getVendorTarget("nonexistent")).toThrow("not in manifest");
  });

  it("renderSkill() throws for unknown skill", () => {
    expect(() => renderSkill("nonexistent", "claude")).toThrow("not in manifest");
  });
});

// ── Claude output sync (.claude/skills/ <-> assistant-assets/) ──────────────

describe("claude skill file sync", () => {
  const claudeSkills = readClaudeSkills();
  const skillNames = getSkillNames();

  it("local .claude/skills/ has entries for all canonical skills", () => {
    const missing = skillNames.filter((n) => !claudeSkills.has(n));
    if (missing.length > 0) {
      expect.fail(
        `Canonical skills not in .claude/skills/: ${missing.join(", ")}\n` +
        "Run `ndx init .` to regenerate, or create matching " +
        ".claude/skills/<name>/SKILL.md files.",
      );
    }
  });

  it("local .claude/skills/ has no extra skills beyond the canonical set", () => {
    const nameSet = new Set(skillNames);
    const extra = [...claudeSkills.keys()].filter((n) => !nameSet.has(n));
    if (extra.length > 0) {
      expect.fail(
        `Extra skills in .claude/skills/ not in canonical source: ${extra.join(", ")}\n` +
        "Add them to assistant-assets/ or remove from .claude/skills/.",
      );
    }
  });

  for (const name of skillNames) {
    it(`"${name}" Claude output matches canonical render`, () => {
      const local = claudeSkills.get(name);
      if (!local) return; // covered by the "has entries" test above

      const expected = renderClaudeSkill(name);

      if (normalize(local) !== normalize(expected)) {
        const localLines = normalize(local).split("\n");
        const expectedLines = normalize(expected).split("\n");
        let diffLine = -1;
        for (let i = 0; i < Math.max(localLines.length, expectedLines.length); i++) {
          if (localLines[i] !== expectedLines[i]) {
            diffLine = i + 1;
            break;
          }
        }
        expect.fail(
          `Skill "${name}" is out of sync (first difference at line ${diffLine}).\n` +
          "Update assistant-assets/skills/" + name + ".md (canonical source), " +
          "then run `ndx init .` to regenerate .claude/skills/.",
        );
      }
    });
  }
});

// ── claude-integration.js uses canonical source ─────────────────────────────

describe("claude-integration.js uses canonical source", () => {
  const src = readFileSync(join(ROOT, "claude-integration.js"), "utf-8");

  it("imports from assistant-assets/", () => {
    expect(src).toContain("from \"./assistant-assets/index.js\"");
  });

  it("does not contain inline SKILLS object", () => {
    // The old pattern was `const SKILLS = {` with template literals.
    // The new pattern uses a lazy getter wrapping renderAllClaudeSkills().
    if (/^const SKILLS\s*=\s*\{/m.test(src)) {
      expect.fail(
        "claude-integration.js still contains an inline SKILLS object.\n" +
        "It should import skills from assistant-assets/ instead.",
      );
    }
  });
});
