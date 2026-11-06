---
id: "c76674c4-296a-4763-98b4-2557bcafcef7"
type: "task"
title: "Run controls say Start and Live run, and runnable rows outside Ready to run name their change"
slug: "run-controls-say-start-and-live-run"
description: "Controls call every runnable unit a task: TaskStartControl's default label \"Start Task\" (packages/web/src/viewer/components/task-start-control.ts:21) and the \"Live Task\" view label (views/view-meta.ts:77-81). Change them to \"Start\" and \"Live run\". Every runnable row reads \"<task title> · in <change title>\" (a task-less change shows its own title and \"runs as one task\"): Live's running and Up next rows, the Sidecar work card, and the run-plan card's track rows. Ready to run is covered by task e07a0471 in change fab17b38; do not edit ready-to-run.ts here. Use one shared formatter for the row text. Shared rules: on a v1 tree (.rex/prd_tree/) the v1 words stay as they are — change only what a v2 tree shows; viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; change user-facing words only, not stored field names, CLI flags or MCP tool names (0.9.0 soft freeze); run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "Start controls and the Live view say Start and Live run (viewer tests)"
  - "Live rows and Sidecar work and run-plan rows name the change (viewer tests)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
