---
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

New `hench.projectSkills` setting names project skills that `ndx work` agents read before the work each one covers (opt-in, default none).

Each name is a directory under `.claude/skills/` or `.agents/skills/`. Every run's system prompt lists the named skills by path and description and tells the agent to read the file first, because a run cannot invoke a skill by name: hench does not grant Claude's `Skill` tool, whose `allowed-tools` frontmatter could widen the run's command policy. A name with no `SKILL.md` is skipped with a warning. The setting is opt-in because the same directories hold operator workflows such as `ndx-work` that a running agent must not follow. Set it with `ndx config hench.projectSkills '["<name>"]' .`; the dashboard lists it under execution settings.
