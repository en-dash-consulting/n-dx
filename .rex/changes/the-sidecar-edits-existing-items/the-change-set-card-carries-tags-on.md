---
id: "1718f19f-9f71-4cae-9a3d-e9c50c35737b"
type: "task"
title: "The change-set card carries tags on new items"
slug: "the-change-set-card-carries-tags-on"
description: "propose_prd_change (packages/web/src/server/sidecar/broker-mcp.ts:73-91; server/sidecar/change-set.ts:72-84,198-202) takes title, type, description, acceptanceCriteria, priority and parent but no tags, and the card lets the operator edit title, description and done-when only. Add optional tags to the schema and carry-out, and an editable tags field on the card. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "A change-set card's tags reach the created items and are editable before approval (web test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
