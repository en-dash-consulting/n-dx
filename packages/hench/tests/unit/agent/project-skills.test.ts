import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_SKILL_DESCRIPTION_CHARS,
  readSkillDescription,
  resolveProjectSkills,
} from "../../../src/agent/planning/project-skills.js";
import { buildSystemPrompt } from "../../../src/agent/planning/prompt.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import { validateConfig } from "../../../src/schema/validate.js";

function writeSkill(root: string, dir: string, name: string, description: string): void {
  mkdirSync(join(root, dir, name), { recursive: true });
  writeFileSync(
    join(root, dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );
}

describe("readSkillDescription", () => {
  it("reads a plain and a quoted frontmatter description", () => {
    expect(readSkillDescription("---\nname: a\ndescription: Does a thing.\n---\nbody")).toBe("Does a thing.");
    expect(readSkillDescription('---\ndescription: "Quoted: yes"\n---\n')).toBe("Quoted: yes");
  });

  it("returns empty without frontmatter or a description key", () => {
    expect(readSkillDescription("# no frontmatter\ndescription: nope")).toBe("");
    expect(readSkillDescription("---\nname: a\n---\n")).toBe("");
  });
});

describe("resolveProjectSkills", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "hench-skills-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves only the named skills, preferring .claude/skills over .agents/skills", () => {
    writeSkill(root, ".claude/skills", "release-notes", "Write changesets.");
    writeSkill(root, ".agents/skills", "release-notes", "Codex copy.");
    writeSkill(root, ".agents/skills", "codex-only", "Only here.");
    writeSkill(root, ".claude/skills", "ndx-work", "Pick a task.");

    const { skills, missing } = resolveProjectSkills(root, ["release-notes", "codex-only"]);
    expect(skills).toEqual([
      { name: "release-notes", path: ".claude/skills/release-notes/SKILL.md", description: "Write changesets." },
      { name: "codex-only", path: ".agents/skills/codex-only/SKILL.md", description: "Only here." },
    ]);
    expect(missing).toEqual([]);
  });

  it("reports names with no file, and refuses names that are not one path segment", () => {
    writeSkill(root, ".claude/skills", "real", "x");
    const { skills, missing } = resolveProjectSkills(root, ["real", "absent", "../escape", "a/b", "real"]);
    expect(skills.map((s) => s.name)).toEqual(["real"]);
    expect(missing).toEqual(["absent", "../escape", "a/b"]);
  });

  it("cuts a long description at a word boundary", () => {
    writeSkill(root, ".claude/skills", "long", "word ".repeat(200).trim());
    const [skill] = resolveProjectSkills(root, ["long"]).skills;
    expect(skill.description.length).toBeLessThanOrEqual(MAX_SKILL_DESCRIPTION_CHARS + 1);
    expect(skill.description.endsWith("word…")).toBe(true);
  });

  it("resolves nothing when no names are configured", () => {
    writeSkill(root, ".claude/skills", "real", "x");
    expect(resolveProjectSkills(root, undefined)).toEqual({ skills: [], missing: [] });
  });
});

describe("buildSystemPrompt project skills", () => {
  const base = { name: "p", validateCommand: "npm run typecheck", testCommand: "npm test" };

  it("lists each skill with its path and tells the agent to read it", () => {
    const prompt = buildSystemPrompt(
      { ...base, skills: [{ name: "release-notes", path: ".claude/skills/release-notes/SKILL.md", description: "Write changesets." }] },
      DEFAULT_HENCH_CONFIG(),
    );
    expect(prompt).toContain("## Project Skills");
    expect(prompt).toContain("read its file first and follow it");
    expect(prompt).toContain("- `release-notes` (`.claude/skills/release-notes/SKILL.md`): Write changesets.");
  });

  it("omits the section when no skills are resolved", () => {
    expect(buildSystemPrompt(base, DEFAULT_HENCH_CONFIG())).not.toContain("## Project Skills");
    expect(buildSystemPrompt({ ...base, skills: [] }, DEFAULT_HENCH_CONFIG())).not.toContain("## Project Skills");
  });
});

describe("hench.projectSkills config", () => {
  it("accepts skill directory names and rejects paths", () => {
    expect(validateConfig({ ...DEFAULT_HENCH_CONFIG(), projectSkills: ["ndx-release-notes"] }).ok).toBe(true);
    expect(validateConfig({ ...DEFAULT_HENCH_CONFIG(), projectSkills: ["../x"] }).ok).toBe(false);
  });
});
