---
id: "3928f6b4-d0f8-4943-8185-f0c6cba12ddb"
type: "task"
title: "Document the test worker cap and add its changeset"
slug: "document-the-test-worker-cap-and-add"
description: "PR 1 of 3 (worker cap), task 3 of 3: closes PR 1.\n\nDocument what PR 1 shipped:\n- TESTING.md: `NDX_TEST_MAX_WORKERS`, what unset means, and that a developer running several worktrees can export it.\n- docs/guide/configuration.md: `hench.testGate.maxWorkers`, its default (unset, no change) and that it reaches the gate, post-task tests, the completion test run and the agent's shell.\n- hench docs where the test gate is described, and packages/hench/AGENTS.md only if it already covers gate settings (keep within the instruction-size budget; detail goes in docs/).\n\nAdd a patch changeset for `@n-dx/hench` (scoped name; read .claude/skills/ndx-release-notes/SKILL.md first). The vitest helper is repository tooling and needs no changeset.\n\nIf a docs page is checked by a root docs test (scripts/lib/select-suites.mjs VALIDATED_DOC_PAGES), run that test. Build docs with `npx vitepress build docs` if you touch the VitePress sidebar."
acceptanceCriteria:
  - "TESTING.md and docs/guide/configuration.md describe NDX_TEST_MAX_WORKERS and hench.testGate.maxWorkers accurately"
  - "A patch changeset for @n-dx/hench describes the new setting"
  - "Root docs tests that read the edited pages pass"
priority: "medium"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-1-worker-cap"
  - "docs"
source: "ndx-capture"
blockedBy:
  - "d34d2902-408a-4b05-9de9-7b2932aae778"
  - "9861a7ad-5ff9-47b7-863e-b38ac6cd5da1"
---
