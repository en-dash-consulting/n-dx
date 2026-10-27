---
id: "e48bf63e-f27e-4a57-b092-620c98c4b456"
type: "task"
title: "Wire plan-mode prevention skill into hench agent prompt assembly and add regression coverage"
slug: "wire-plan-mode-prevention-skill-into"
description: "Ensure the new skill is injected into the prompt/skill set used by hench-driven Claude agent runs (and any other ndx execution paths that spawn agents), and add a regression test asserting that the skill appears in the assembled prompt context for autonomous runs. This closes the loop so the rule is actually applied at runtime, not just authored."
acceptanceCriteria:
  - "Hench agent prompt assembly includes the no-plan-mode skill for autonomous and acceptEdits-mode runs"
  - "Regression test fails if the skill is removed from the assembled skill list for autonomous runs"
  - "Documentation in CLAUDE.md or AGENTS.md references the skill where plan-mode behavior is discussed"
  - "Manual smoke run of `ndx work --auto` confirms the agent does not emit ExitPlanMode for execution tasks"
priority: "high"
tags:
  - "agent"
  - "hench"
  - "testing"
source: "smart-add"
---
