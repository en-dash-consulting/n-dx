---
id: "248c2e12-b61b-45d8-ab7d-8efa90b6a8ef"
type: "task"
title: "The status dock drops the worktrees pill and the uncommitted-files warning moves to the bottom bar"
slug: "the-status-dock-drops-the-worktrees"
description: "Operator decision 2026-10-28: the floating pills clutter the page, more so with the Sidecar drawer narrowing it. The worktrees pill (SessionsPanel, '119 worktrees · 1 running') repeats the Live tab and Work > Workspaces, so it goes. The uncommitted-files pill (GitStatusBanner) is the dashboard's only commit, discard and ignore UI, which clears hench's dirty-tree gate, so it moves to a bottom-bar chip (packages/web/src/viewer/components/bottom-bar.ts) that opens the same panel."
acceptanceCriteria:
  - "The status dock no longer shows the worktrees pill; SessionsPanel (sessions-panel.ts), its stylesheet and its test are removed, since main.ts is their only user (tested)"
  - "When the working tree is dirty, the bottom bar shows an orange 'N uncommitted' chip that opens the existing commit panel (review diffs, commit, discard, ignore); with a clean tree it shows nothing (tested)"
  - "No working-tree status pill is left floating in the status dock (tested)"
  - "The remaining dock pills (active operations, refresh queue) keep their place and still sit left of an open Sidecar drawer (tested)"
priority: "medium"
source: "ndx-capture"
---
