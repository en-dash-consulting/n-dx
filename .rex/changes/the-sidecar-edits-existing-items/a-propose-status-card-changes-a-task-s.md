---
id: "5d52fd20-ac23-407f-808a-5cc245065564"
type: "task"
title: "A propose_status card changes a task's status after approval"
slug: "a-propose-status-card-changes-a-task-s"
description: "The Sidecar cannot change an item's status (rex update_task_status). Add a broker tool propose_status {id, status, reason?} with an always-ask card showing the current and proposed status and rex's own transition rules; carry-out uses the same rex path as update_task_status (completion still runs rex's checks). Wire it as propose_item_edit is wired (broker-policy.ts, broker-mcp.ts, carry-out.ts, SidecarActions, routes-sidecar.ts). Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "Approving a propose_status card sets the status through rex's rules (web test)"
  - "A transition rex refuses comes back as a failed card with rex's message (web test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
