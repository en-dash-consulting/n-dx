---
id: "d143adff-01b4-4459-b703-a9c1fccc4141"
type: "task"
title: "v2 screens drop epic and feature, and the dashboard glossary defines change, task, subtask, Inbox and runs as one task"
slug: "v2-screens-drop-epic-and-feature-and"
description: "v1 words leak onto v2 screens through the v1 projection. Fix each on a v2 tree: the PRD tree view's meta in packages/web/src/viewer/views/view-meta.ts:182-221 (\"Tasks\" described as \"epics, features, tasks\": call it \"Change tree\" with a v2 description, matching the Plan redesign's Tree tab), the view header and the epic/feature/task InfoTip in views/prd.ts:279 and :353, the Up Next tiles that count changes as epics (views/rex-dashboard.ts:248 and the rex-dash-epic labels; class names may stay), and the search overlay's type filter (components/search-overlay.ts:56-59), which must offer Change, Task and Subtask on v2. Add Change, Task, Subtask, Inbox and \"Runs as one task\" entries to components/glossary-terms.ts (the epic/feature/task entry at :61-63 stays for v1). Use the item-type display helpers in src/shared/item-type.ts (:243-252) rather than new string literals. Shared rules: on a v1 tree (.rex/prd_tree/) the v1 words stay as they are — change only what a v2 tree shows; viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; change user-facing words only, not stored field names, CLI flags or MCP tool names (0.9.0 soft freeze); run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "On a v2 tree the tree view, Up Next and search show no epic or feature (viewer tests)"
  - "On a v1 tree they read as before (viewer test)"
  - "The glossary has the five new entries (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
