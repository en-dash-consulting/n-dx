---
id: "4aa01e0c-31d5-4db0-9386-214b01da32dd"
type: "capability"
title: "Workflow Skill Wording & Termination Clarity"
slug: "workflow-skill-wording-termination"
statement: "The skill termination guard checks that each project workflow skill under .claude/skills/ ends with a \"## Done when\" section that states the skill's scope boundary as an explicit phrase, not as an incidental negation word."
criteria: [{"id":"c1","text":"If a skill's \"## Done when\" section contains an incidental negation but no scope statement (for example \"delivered, whether or not the user acts on it\"), the skill termination guard shall fail that skill."},{"id":"c2","text":"When a skill's \"## Done when\" section states its boundary with \"no <noun>\" phrasing (such as \"produces no output, writes no file, and requires no record\"), the skill termination guard shall pass that skill."},{"id":"c3","text":"The skill termination guard shall pass each of the 13 current project workflow skills."},{"id":"c4","text":"When the skill termination guard fails a skill, the guard shall name in its failure message the phrasing that the skill's \"## Done when\" section is missing."}]
tags:
  - "prompts"
  - "skills"
  - "workflows"
source: "ndx-capture"
priority: "high"
---

Rewrite the 13 project workflow skills under .claude/skills/ so each one drives the agent to its intended outcome by the shortest path. Sizes vary widely (iso-map 121 lines, ndx-adversarial-review 107, triage 86, down to ndx-zone at 12), and the long ones carry the most restated context and the most conditional branching. Each skill needs a stated goal, an explicit stopping condition, and no step that duplicates what the hench brief or the MCP tool descriptions already supply.
