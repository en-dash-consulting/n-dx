---
id: "5dddfe54-9bb7-4d15-bc22-f3d2ac2de893"
level: "task"
title: "Author plan-mode prevention skill definition with explicit no-plan-mode invariant"
status: "completed"
priority: "high"
tags:
  - "agent"
  - "skills"
  - "hench"
source: "smart-add"
startedAt: "2026-05-12T14:48:39.408Z"
completedAt: "2026-05-13T20:18:58.036Z"
endedAt: "2026-05-13T20:18:58.036Z"
acceptanceCriteria:
  - "Skill file exists in the canonical skills location with a clear name, description, and trigger metadata"
  - "Skill body explicitly forbids entering plan mode, calling ExitPlanMode as a stall, or producing plan-only responses for execution tasks"
  - "Skill includes a 1–2 sentence rationale tying the rule to autonomous run continuity"
  - "Skill is listed in the available-skills inventory surfaced to agents"
description: "Create a Claude Code skill (e.g. `no-plan-mode`) under the assistant skills directory that documents the rule 'do not use plan mode' with rationale, applicability scope (all hench/ndx-driven agent runs), and concrete instructions the agent must follow when it would otherwise call ExitPlanMode or enter plan-only behavior. Include a short trigger description so the skill is auto-selected for execution-oriented prompts."
---
