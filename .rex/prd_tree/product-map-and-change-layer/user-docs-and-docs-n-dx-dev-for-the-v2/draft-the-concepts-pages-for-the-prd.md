---
id: "bc0aa415-331f-406f-8d14-2eff065dd91f"
level: "task"
title: "Draft the concepts pages for the PRD as product layer plus change layer"
status: "completed"
priority: "high"
tags:
  - "pr-28"
  - "lane-core-docs"
  - "docs"
source: "roadmap"
startedAt: "2026-10-08T07:26:22.353Z"
completedAt: "2026-10-08T07:30:29.824Z"
resolutionType: "code-change"
resolutionDetail: "Five concepts pages under docs/guide/concepts/ plus a Concepts sidebar group, written and reviewed by hench run 56139eb6-ae65-450e-be65-1db53119577e. The run left them uncommitted because its sandbox refused pnpm docs:build; pnpm docs:build verified by hand and the pages committed unchanged in 2d38ade41."
endedAt: "2026-10-08T07:30:29.824Z"
acceptanceCriteria:
  - "A concepts section defines the PRD as the product layer plus the change layer, with the glossary and at least one worked example"
  - "No page uses \"map\" for the product layer"
  - "pnpm docs:build passes"
description: "New concepts pages under docs/guide: what the PRD is (product layer + change layer + evidence), the glossary (area, capability, constraint, change, task, apply, evidence, status and health), how a request becomes a change and how apply updates the requirements, bugs and hotfixes, and stewards. Use real n-dx examples. Written from the design; no code dependency.\n\n## Operator note (inputs and constraints for this run)\n\n- The design this task is written from is not in the repo. A plain-text excerpt (Summary through Stewards) is at .run-logs/pr28-design-reference.md (gitignored; read it, never commit or copy it wholesale). Its header lists where main's code overrides the design: packages/rex/src/schema/v2.ts and v2-rules.ts win.\n- Docs only: new pages under docs/guide/ (a concepts section), linked from the VitePress sidebar in docs/.vitepress/config.ts. Change no package source, tests or generated files.\n- Never use \"map\" for the product layer or the PRD. \"Map\" only ever means the codebase map.\n- Use real n-dx examples (the design's glossary has them: areas such as Execute work, the Session strategy capability, the architecture-integrity constraint, change #473).\n- These pages describe the 1.0.0 model, which is still landing; say so plainly where a page describes behaviour that ships with 1.0.0.\n- `pnpm docs:build` must pass. The affected test gate selects no suite for docs, so run it yourself before committing."
lastModified: "2026-10-08T07:30:30.080Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
