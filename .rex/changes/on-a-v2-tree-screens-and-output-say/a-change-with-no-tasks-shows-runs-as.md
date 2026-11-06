---
id: "58e97129-66cf-472a-9371-cb2bf7ce9c14"
type: "task"
title: "A change with no tasks shows \"runs as one task\", gets a Start button and accepts run settings"
slug: "a-change-with-no-tasks-shows-runs-as"
description: "ndx work runs a task-less change as its own unit (rex/src/core/change-selection.ts:86-120, changeWorkShape kind \"unit\"), but the dashboard treats it as not runnable: the task detail panel gives it no Start (packages/web/src/viewer/components/prd-tree/task-detail.ts:1137, 1266-1268), isWorkItemType in src/shared/item-type.ts:156-164 is task|subtask only, saving run settings refuses it as \"not a work item\" (src/server/routes-hench-prep.ts:417), and the Changes view says \"no tasks\" (views/changes.ts:29-31). Have the server say which items are runnable units (from the rex selection's work shape, through the rex gateway; a change with open tasks and a container are not) and use that: the detail panel shows TaskStartControl for a unit change, run settings save for it, and the Changes view reads \"runs as one task\". Do not widen isWorkItemType for callers that mean task|subtask; add a separate predicate. Gateway exports stay within their ceiling (docs/architecture/gateways.md); prefer sending the computed flag from the server. Shared rules: on a v1 tree (.rex/prd_tree/) the v1 words stay as they are — change only what a v2 tree shows; viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; change user-facing words only, not stored field names, CLI flags or MCP tool names (0.9.0 soft freeze); run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "A task-less change's detail panel shows Start and starts it (viewer and web tests)"
  - "Saving run settings on a task-less change succeeds; on a change with tasks it is still refused (web tests)"
  - "The Changes view reads runs as one task for it (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
