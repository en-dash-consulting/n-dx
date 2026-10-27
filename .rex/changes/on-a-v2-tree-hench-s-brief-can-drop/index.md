---
id: "86536c82-eb93-4810-8610-f6960ff36736"
type: "change"
title: "On a v2 tree hench's brief can drop workflow.md whole when rex's 4,000-token budget runs out"
slug: "on-a-v2-tree-hench-s-brief-can-drop"
intent: "Verdict: should-fix (medium). Found reviewing dfb907e5 (hench briefs a v2 task from its change).\n\nScenario: on a v2 tree, packages/hench/src/agent/planning/brief.ts (changeBriefSections) hands workflow.md to rex's buildChangeBrief. Rex treats `workflow` as an atomic section near the end of RETENTION_ORDER (packages/rex/src/core/change-brief.ts:176) under one BRIEF_TOKEN_BUDGET of 4,000 tokens. Take a task with a long description (up to 2,000 chars) in a change with several amendments and three or more capabilities with criteria. The required task and change sections plus capabilities/constraints use up the allowance, so the whole workflow section is omitted and only a \"Sections not shown: workflow\" note remains. This repo's .rex/workflow.md is 1,565 chars (about 400 tokens) and holds the execution rules: TDD, the PROHIBITED CHANGES list, one task per run. On v1, formatTaskBrief always includes workflow, trimmed to MAX_WORKFLOW_CHARS. So a v2 hench agent can run without the project's rules, on exactly the large changes where they matter most.\n\nReachable: any `ndx work` on a v2 tree whose unit's change is capability-heavy.\n\nOptions:\n1. (recommended) Hench renders workflow itself, outside rex's budget, the way v1 does (trimDocument, MAX_WORKFLOW_CHARS). Don't pass `workflow` to buildChangeBrief; append a hench \"## Workflow\" block. Cost: small, and the change stays in the hench lane. Risk: the brief can exceed rex's budget by the size of the workflow. That is the same as v1 today.\n2. Ask rex to make workflow a required section, or to admit it ahead of the tail sections. This needs a rex change, so it is outside PR 35's lane and is a decision for the rex brief owner (the 20d12416 lane).\n\nDecision for Ryan: whether workflow.md is execution policy that must always reach the agent (option 1) or context that rex may budget away."
acceptanceCriteria:
  - "On a v2 tree whose change brief fills rex's budget (e.g. many capabilities with long criteria), formatTaskBrief still contains the workflow.md text (test)"
  - "v1 brief output is unchanged (existing brief tests pass unedited)"
touches:
  - "be394022-52c9-4317-ab29-8bfa26523593"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-35"
  - "lane-hench"
  - "hench"
source: "ndx-adversarial-review"
blockedBy:
  - "ec23f1dd-c253-47da-a432-9a1674362b9b"
---
