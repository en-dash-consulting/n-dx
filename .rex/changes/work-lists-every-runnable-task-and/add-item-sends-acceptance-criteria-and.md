---
id: "b9f53670-8e31-4f3f-a630-786ca4800d3a"
type: "task"
title: "Add item sends acceptance criteria and tags"
slug: "add-item-sends-acceptance-criteria-and"
description: "The PRD tree Add item form (packages/web/src/viewer/components/prd-tree/add-item-form.ts) asks for type, parent, title, description and priority; AddItemInput declares tags and acceptanceCriteria (:28-35) but the form never sends them (:129-135). Add a done-when list (one criterion per line, add/remove) and a tags field, and send both. Check the add-item-form tests are not the known load flake before blaming the change. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "Add item creates the item with its acceptance criteria and tags (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
