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
  - "Every LLM prompt surface across rex, sourcevision, hench, and core is inventoried with its measured token cost, alongside each .claude/skills/*/SKILL.md and each packages/core/assistant-assets/skills/*.md."
  - "Rex and sourcevision prompts are assembled through the shared PromptEnvelope contract, so per-section cost is attributable in the packages that hold most of the text rather than only in hench."
  - "No instruction on any surface admits two readings of what to change, and no instruction contradicts another surface — whether across prompts in one package, between plan-mode guidance and the no-plan-mode skill, or between a prompt and a rule the code already enforces."
  - "Instructions duplicated across builders that describe the same schema or output contract are stated once and referenced, rather than restated per builder where they can drift apart."
  - "Redundant and dead wording is removed, including any directive referring to a code path that no longer exists or that contradicts the PRD invariant on writable surfaces."
  - "Token cost drops measurably against the recorded baseline for rex, sourcevision, hench, and the long skills, with per-surface before-and-after numbers captured in the repo."
  - "Every workflow skill names its terminating action explicitly, so a run ends on the intended change instead of continuing into optional follow-up work."
  - "Shipped skill copies under packages/core/assistant-assets/skills/ remain consistent with their .claude/skills/ counterparts, allowing for documented front-matter differences, verified by an automated check."
  - "Skills that ship to other repositories remain stack-agnostic: no assumed shell, no assumed package manager, commands discovered rather than hardcoded."
  - "Output quality is unchanged across the board: a hench run, a rex analyze, and a sourcevision deep analysis each reach the same outcome as before the rewrite, confirming that tightening dropped no needed instruction."
description: "Audit and tighten every prompt surface that drives an LLM, across four packages plus the workflow skills. A census at capture time located the static prompt text: rex ~12,565 tokens across 31 literals in 12 files (roughly 16 builders under analyze/ plus core/reorganize.ts), sourcevision ~1,997 across 12 in the enrich and classify pipeline, core one surface in pair-programming.js, and hench four prompt modules whose volume is understated by literal scanning because it assembles prompts from short fragments. Web contains no LLM prompts. Alongside these sit the 13 workflow skills in .claude/skills/ and their 10 shipped counterparts in packages/core/assistant-assets/. The enabling structural fact: llm-client already provides PromptEnvelope, PromptSection and per-section diagnostics, but every one of the 30 files using it is hench or llm-client's own tests — the packages holding the bulk of the text have no measurement seam. Goal: each instruction states one unambiguous intent, token cost is measured and reduced against a recorded baseline, and each prompt drives the model to the intended change by the shortest path, with an explicit terminating action so runs stop on the intended change rather than trailing into optional work. Interactive readline prompts are not LLM prompts and are out of scope."
lastModified: "2026-09-08T13:41:34.610Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Extend PromptEnvelope Beyond Hench](./extend-promptenvelope-beyond-hench.md) | completed |
| [Hench Runtime Prompt Tightening](./hench-runtime-prompt-tightening.md) | completed |
| [Prompt Token-Cost Baseline & Measurement](./prompt-token-cost-baseline-measurement.md) | completed |
| [Rex Analyze Prompt Consolidation](./rex-analyze-prompt-consolidation.md) | completed |
| [Shipped Assistant-Asset Prompt Parity & Portability](./shipped-assistant-asset-prompt-parity.md) | pending |
| [SourceVision Enrich & Core Reviewer Prompt Tightening](./sourcevision-enrich-core-reviewer.md) | pending |
| [Workflow Skill Wording & Termination Clarity](./workflow-skill-wording-termination.md) | completed |
