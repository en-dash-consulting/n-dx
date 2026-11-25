---
id: "828e4baa-879a-4674-8420-a7fde376e508"
type: "task"
title: "Render consumer projects' CLAUDE.md and AGENTS.md from a project-neutral guidance template"
slug: "render-consumer-projects-claude-md-and"
summary: "Give every project short guidance on using n-dx, and keep the n-dx source-code notes for the n-dx repository only."
description: "Add packages/core/assistant-assets/consumer-guidance.md: a short, project-neutral block on using n-dx in this repository (what rex, sourcevision and hench are for, where the PRD and analysis live, the MCP servers and their main tools, the ndx commands to reach for, and that code changes go through `ndx work`). Keep the `<!-- ADDENDUM -->` marker so the Claude addendum still lands, and make sure renderAgentsMd's section filtering (MCP Servers, Development Workflow) still works on it. Choose the template per project: n-dx's own project-guidance.md only when the project is an n-dx checkout, detected from its files (`<dir>/packages/core/assistant-assets/project-guidance.md` exists), and consumer-guidance.md for every other project. Pass the project dir to renderClaudeMd so it can choose. Ship consumer-guidance.md in the package files. Keep it short: tests/e2e/agents-md-size-budget.test.js should get a budget for the consumer render as well.\n\n**Operator note (re-run after run b100305d).** The first run implemented the templates and the selection (commit af56badd6: consumer-guidance.md, consumer-claude-addendum.md, usesNdxGuidance / renderClaudeMd(dir) in assistant-assets.js) but selected through an `assistant.guidance` key in the tracked .n-dx.json. A run cannot write .n-dx.json (the session refuses it and the concurrency contract reverts it), so that design is dropped: do NOT edit .n-dx.json and do not read a config key for this. Replace the config read in usesNdxGuidance with the file-based detection above, keep the rest of af56badd6, and add the tests listed in the criteria. The six static root policy tests (tests/e2e/architecture-policy, domain-isolation, shell-spawn-inventory-policy, wall-clock-inventory-policy, layout-literal-policy, obfuscated-code-policy) must still pass. Add a patch changeset for @n-dx/core."
acceptanceCriteria:
  - "renderClaudeMd(dir) and renderAgentsMd(dir) for a project that is not an n-dx checkout produce text containing none of: 'Three packages that chain together', 'Gateway modules', 'four-tier', 'tests/e2e/'"
  - "This repository is detected as an n-dx checkout from its files, no config key is read for it, and its regenerated CLAUDE.md and AGENTS.md are unchanged by this task"
  - "consumer-guidance.md and consumer-claude-addendum.md are in @n-dx/core's published files and tests/e2e/published-package-loadability.test.js still passes"
  - "A test runs ndx init --no-llm --no-commit in a temp repo and asserts the consumer text in both files"
  - "The consumer CLAUDE.md is under a size budget asserted by a test"
priority: "high"
tags:
  - "core"
  - "init"
  - "assistant-assets"
source: "ndx-capture"
---
