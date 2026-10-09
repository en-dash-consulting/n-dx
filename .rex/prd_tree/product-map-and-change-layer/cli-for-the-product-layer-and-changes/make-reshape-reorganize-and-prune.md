---
id: "91461587-ce70-4f31-a6bf-ea3d42364a3c"
level: "task"
title: "Make reshape, reorganize and prune layer-aware"
status: "pending"
priority: "medium"
tags:
  - "pr-18"
  - "lane-rex-surface"
  - "rex"
  - "core"
blockedBy:
  - "08b9e858-4312-4945-9dd5-6c211884d5f6"
source: "roadmap"
acceptanceCriteria:
  - "Reshape on product nodes produces a drafted change and moves no files (test)"
  - "reorganize and prune never write under product/ (test)"
description: "Change layer works as today. On the product layer, reshape drafts a change with removed and added amendments; reorganize only reports; prune does not apply.\n\nDesign boundary (PR 18, 2026-10-09):\n- v1 trees keep today's behaviour exactly, as PR 17 did for add_item. On a v2 tree, ndx add, smart-add and capture create a change and propose placement; on a v1 tree they add a level-based item as today. rex health on a v1 tree reports exactly what it reports today; the v2 tree rules (f5d8c06e) and the landing check (da151468) run on v2 trees only. This repository's own PRD is v1, and ndx add, rex add, smart-add and rex health are used on it every day.\n- No skill text changes (.claude/, .agents/, packages/core/assistant-assets/skills/). Rewriting the PRD skills for v2 is PR 24 (d5f63839).\n- Write paths go through PR 31's store transaction (store.withTransaction).\n- Lane files: packages/rex/src/cli/ (commands, help), packages/rex/src/core/health.ts and the reshape/reorganize/prune modules, tree-diff, and packages/core for ndx add routing (spawn only, no library imports in orchestration scripts). Do not change web, hench, MCP tool shapes or the v2 schema.\n- Terminology: \"capability criteria\" for a capability's criteria; \"acceptance criteria\" (or \"done when\") for a work item's acceptanceCriteria. Never a bare \"criteria\" in help text or errors."
lastModified: "2026-10-09T06:30:19.788Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
