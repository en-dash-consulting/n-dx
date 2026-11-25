---
id: "828e4baa-879a-4674-8420-a7fde376e508"
type: "task"
title: "Render consumer projects' CLAUDE.md and AGENTS.md from a project-neutral guidance template"
slug: "render-consumer-projects-claude-md-and"
summary: "Give every project short guidance on using n-dx, and keep the n-dx source-code notes for the n-dx repository only."
description: "Add packages/core/assistant-assets/consumer-guidance.md: a short, project-neutral block on using n-dx in this repository (what rex, sourcevision and hench are for, where the PRD and analysis live, the MCP servers and their main tools, the ndx commands to reach for, and that code changes go through `ndx work`). Keep the `<!-- ADDENDUM -->` marker so the Claude addendum still lands, and make sure renderAgentsMd's section filtering (MCP Servers, Development Workflow) still works on it. Choose the template per project: n-dx's own project-guidance.md only when the project opts in through a config key in its tracked .n-dx.json (for example `assistant.guidance: \"n-dx\"`), which this repository sets; every other project gets consumer-guidance.md. Pass the project dir to renderClaudeMd so it can choose. Ship consumer-guidance.md in the package files. Keep it short: tests/e2e/agents-md-size-budget.test.js should get a budget for the consumer render as well."
acceptanceCriteria:
  - "renderClaudeMd(dir) and renderAgentsMd(dir) for a project without the opt-in key produce text containing none of: 'Three packages that chain together', 'Gateway modules', 'four-tier', 'tests/e2e/'"
  - "This repository's .n-dx.json opts in, and its regenerated CLAUDE.md and AGENTS.md are unchanged by this task"
  - "consumer-guidance.md is listed in @n-dx/core's published files and tests/e2e/published-package-loadability.test.js still passes"
  - "A test runs ndx init --no-llm --no-commit in a temp repo and asserts the consumer text in both files"
  - "The consumer CLAUDE.md is under a size budget asserted by a test"
priority: "high"
tags:
  - "core"
  - "init"
  - "assistant-assets"
source: "ndx-capture"
---
