---
id: "e07a0471-db0d-4301-9485-1dc5462a9b6d"
type: "task"
title: "Ready to run lists every runnable task with search, filters and Start on each row"
slug: "ready-to-run-lists-every-runnable-task"
description: "Ready to run (packages/web/src/viewer/components/ready-to-run.ts:80) calls GET /api/hench/ready?limit=10 (packages/web/src/server/routes-hench-prep.ts:690, limit max 50 at :85-86), which sorts findActionableTasks by priority. The route uses the v1 selector findActionableTasks over the projected document, not the v2 findActionableWork hench uses (packages/hench/src/agent/planning/work-selection.ts:3-8 explains why the v1 selector picks Inbox changes and ignores a change's gates), so on v2 switch it to findActionableWork through the rex gateway: Inbox changes never list, a task-less change lists as runnable, and a change with tasks lists its tasks. Make the list complete: the route pages through every actionable task (keep the claim and stuck exclusions), the view shows the top rows then \"Show all N\", with a text search and filters for priority, change and tags, each row keeping Start now and Prepare. Each row names its change. Keep the route fast on a 1,400-change tree (read once, no per-row file reads). Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "Ready to run can show every actionable task, low priority included (viewer and web tests)"
  - "Search and the priority, change and tag filters narrow the list (viewer test)"
  - "Each row starts its task (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
