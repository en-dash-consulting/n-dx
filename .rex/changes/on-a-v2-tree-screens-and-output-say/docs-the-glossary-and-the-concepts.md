---
id: "bd91becc-3a9e-48b0-a063-52fbcf0c8cc9"
type: "task"
title: "Docs: the glossary and the concepts pages use the P1 words"
slug: "docs-the-glossary-and-the-concepts"
description: "Update docs/guide/concepts/glossary.md (:15-16, :45-55) and any concepts page that calls a change's tasks or a task-less change by v1 or mixed words: change, task, subtask, \"runs as one task\", PRD edits (the Sidecar card) and track (plan-queue). Note that the change kind \"Feature\" is a kind, not a v1 level. Do not add design-doc references. Keep the VitePress build and the docs link checks green. Add a patch changeset if a package's docs change. Shared rules: on a v1 tree (.rex/prd_tree/) the v1 words stay as they are — change only what a v2 tree shows; viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; change user-facing words only, not stored field names, CLI flags or MCP tool names (0.9.0 soft freeze); run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "The glossary defines runs as one task, PRD edits and track, and the docs build passes (docs checks)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":false}
source: "ndx-capture"
---
