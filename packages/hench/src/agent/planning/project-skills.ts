/**
 * Project skills named for hench runs (`hench.projectSkills`).
 *
 * A spawned Claude session cannot invoke a skill by name: hench's
 * `--allowed-tools` list does not grant `Skill`, and granting it would let a
 * skill's own `allowed-tools` frontmatter widen the run's command policy. Codex
 * and the API loop have no skill mechanism hench controls either. So the
 * system prompt lists the skills the operator opted into, by path, and tells
 * the agent to read the file before the work it covers.
 *
 * Opt-in rather than discovered: a project's skill directory also holds
 * operator workflows (`ndx-work` picks a task, `ndx-plan` proposes PRD
 * changes) that an agent mid-task must not follow.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskBriefProjectSkill } from "../../schema/index.js";

/** Skill directories searched, in order; the first that holds the skill wins. */
export const PROJECT_SKILL_DIRS = [".claude/skills", ".agents/skills"] as const;

/** A skill name is one path segment: no separators, no `..`. */
export const PROJECT_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Descriptions longer than this are cut at a word boundary. */
export const MAX_SKILL_DESCRIPTION_CHARS = 300;

export interface ResolvedProjectSkills {
  skills: TaskBriefProjectSkill[];
  /** Names configured but not found (or not a valid name) — for a warning. */
  missing: string[];
}

/**
 * The frontmatter `description:` of a SKILL.md, or "" when there is none.
 * Single-line values only, which is what every skill this repo writes uses;
 * surrounding quotes are dropped.
 */
export function readSkillDescription(text: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return "";
  const line = match[1].split(/\r?\n/).find((l) => l.startsWith("description:"));
  if (!line) return "";
  const value = line.slice("description:".length).trim();
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Resolve configured skill names against the project's skill directories. */
export function resolveProjectSkills(
  projectDir: string,
  names: readonly string[] | undefined,
): ResolvedProjectSkills {
  const skills: TaskBriefProjectSkill[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const name of names ?? []) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!PROJECT_SKILL_NAME.test(name)) {
      missing.push(name);
      continue;
    }
    const path = PROJECT_SKILL_DIRS.map((dir) => `${dir}/${name}/SKILL.md`).find((rel) =>
      existsSync(join(projectDir, rel)),
    );
    if (!path) {
      missing.push(name);
      continue;
    }
    let description = "";
    try {
      description = readSkillDescription(readFileSync(join(projectDir, path), "utf-8"));
    } catch {
      // Unreadable: list it by path anyway; the agent's own read reports why.
    }
    skills.push({ name, path, description: truncate(description, MAX_SKILL_DESCRIPTION_CHARS) });
  }
  return { skills, missing };
}
