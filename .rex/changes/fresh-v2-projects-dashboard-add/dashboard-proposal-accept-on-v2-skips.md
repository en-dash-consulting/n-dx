---
id: "7b90b62a-a4cf-4a6b-b9ec-789e4dcc642f"
type: "task"
title: "Dashboard proposal accept on v2 skips the Inbox and drops proposed subtasks"
slug: "dashboard-proposal-accept-on-v2-skips"
description: "POST /api/rex/proposals/accept and /accept-edited (packages/web/src/server/routes-rex-analysis.ts:717-856 and :864-1022) have no v2 branch. They call store.addItem with v1 epic, feature and task items. On v2, changeLayerFromItems turns those into nested changes without needsPlacement, so the changes never appear in the Inbox. The decomposition subtasks and sourceFile are dropped, and accept-edited replaces the source with 'web-proposal-editor'. The CLI path (acceptProposalsAsChanges, then changeInputsFromProposals) already lands changes in the Inbox, but it also drops decomposition.children."
acceptanceCriteria:
  - "On v2 both dashboard accept routes create changes the way rex analyze --accept does: in the Inbox with needsPlacement, keeping criteria, tags, priority and source"
  - "Proposed subtasks become tasks under their change on both the CLI and dashboard paths, or the preview says they are not kept"
  - "Route tests cover both accept routes on a v2 tree"
priority: "medium"
tags:
  - "0.10.0"
  - "v2"
  - "fresh-project"
  - "dashboard"
  - "web"
  - "rex"
source: "ndx-capture"
---
