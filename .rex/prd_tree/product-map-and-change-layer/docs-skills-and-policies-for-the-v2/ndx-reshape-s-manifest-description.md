---
id: "617878ae-df3f-4595-a43c-e77544a432c5"
level: "task"
title: "/ndx-reshape's manifest description offers \"change levels\", which a v2 tree refuses"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The ndx-reshape manifest description names no epic or level change"
  - "A test in tests/e2e/skill-prd-layout.test.js fails if a PRD skill's manifest description promises an epic or a level change"
  - ".agents/skills/ndx-reshape/SKILL.md frontmatter matches the new description"
description: "Found by the adversarial review of d5f63839. The skill bodies now branch on the v1/v2 layout, but packages/core/assistant-assets/manifest.json:33 still describes ndx-reshape as \"Restructure the PRD hierarchy — regroup epics, change levels, merge overlaps, create new containers\". That string becomes the frontmatter description in .claude/skills and .agents/skills, and assistants pick a skill by it. Scenario: on a v2 tree a user asks to \"turn this task into a change\", the assistant picks /ndx-reshape because the description promises level changes, and the body then says the type is fixed (edit_item refuses level on v2). Nothing is corrupted; the description simply misdirects. Verdict should-fix: real and cheap, but the body already prevents the wrong write. Fix: make the description layout-neutral, e.g. \"Restructure the PRD — regroup, reparent, merge overlaps and place changes\", then regenerate both vendors' copies. ndx-capture and ndx-work descriptions (\"task\") read fine on both layouts.\n\nOperator notes: do not edit anything under .claude/ (the agent cannot write there; the operator regenerates .claude/skills with renderSkill after the run, so a skill-sync or assistant-body-drift failure caused only by the stale .claude copy is expected). Regenerate the .agents/skills copy yourself. Run the six static root policy tests before finishing: tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy and obfuscated-code-policy."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T04:23:47.218Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
