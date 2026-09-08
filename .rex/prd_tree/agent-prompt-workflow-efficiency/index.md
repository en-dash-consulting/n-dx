---
id: "50db22a8-d28b-41b2-90be-07b1b6a8a89d"
level: "epic"
title: "Agent Prompt & Workflow Efficiency"
status: "pending"
priority: "high"
tags:
  - "prompts"
  - "workflows"
  - "tokens"
  - "agents"
source: "ndx-capture"
acceptanceCriteria:
  - "Every prompt surface is inventoried in one place with its measured token cost: the four hench prompt modules, each .claude/skills/*/SKILL.md, and each packages/core/assistant-assets/skills/*.md."
  - "No instruction on any surface admits two readings of what to change, and no instruction contradicts another surface (for example plan-mode guidance versus the no-plan-mode skill)."
  - "Redundant and dead wording is removed: no restating of context the brief already supplies, no instruction duplicated across brief plus system prompt plus skill, and no directive referring to a code path that no longer exists."
  - "Token cost of an assembled task brief and of a skill invocation both drop measurably against the recorded baseline for the same input, with before and after numbers captured in the repo."
  - "Every workflow skill names its terminating action explicitly, so a run ends on the intended change instead of continuing into optional follow-up work."
  - "Shipped skill copies under packages/core/assistant-assets/skills/ remain consistent with their .claude/skills/ counterparts, allowing for documented front-matter differences, verified by an automated check."
  - "Skills that ship to other repositories remain stack-agnostic: no assumed shell, no assumed package manager, commands discovered rather than hardcoded."
  - "A hench run against a representative task reaches the same outcome as before the rewrite, confirming that tightening the prompts dropped no needed instruction."
description: "Audit and tighten every prompt surface that drives an agent to change code, across three packages: hench's runtime prompts (packages/hench/src/agent/planning/brief.ts, planning/prompt.ts, lifecycle/plan-mode-prompt.ts, lifecycle/prompt-diagnostics.ts), the workflow skills in .claude/skills/, and their shipped counterparts in packages/core/assistant-assets/. Goal: each instruction states one unambiguous intent, token cost per run is measured and reduced against a recorded baseline, and each workflow drives the agent to the intended change by the shortest path — fewer clarifying detours, fewer redundant re-reads, no restating context the agent already holds, and an explicit terminating action so runs stop on the intended change rather than trailing into optional work."
lastModified: "2026-09-08T13:07:15.421Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Hench Runtime Prompt Tightening](./hench-runtime-prompt-tightening.md) | pending |
| [Prompt Token-Cost Baseline & Measurement](./prompt-token-cost-baseline-measurement.md) | pending |
| [Shipped Assistant-Asset Prompt Parity & Portability](./shipped-assistant-asset-prompt-parity.md) | pending |
| [Workflow Skill Wording & Termination Clarity](./workflow-skill-wording-termination.md) | pending |
