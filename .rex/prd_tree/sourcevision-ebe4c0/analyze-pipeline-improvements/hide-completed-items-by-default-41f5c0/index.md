---
id: "41f5c040-e836-40ee-97af-ae5477fe6ae1"
level: "task"
title: "Hide completed items by default in status views"
status: "completed"
priority: "high"
tags:
  - "prune"
  - "reshape"
  - "rex"
  - "status"
  - "ux"
  - "web"
startedAt: "2026-02-10T14:36:17.763Z"
completedAt: "2026-02-10T14:36:17.763Z"
acceptanceCriteria:
  - "CLI rex status hides completed items by default"
  - "CLI rex status --all shows all items including completed"
  - "Web PRD tree defaults to Active Work filter (pending, in_progress, blocked)"
  - "Users can still manually switch to All Items filter in the web UI"
  - "rex prune archives completed subtrees (existing behavior preserved)"
  - "After archiving, a reshape pass runs on remaining items using a new consolidation-focused prompt"
  - "The consolidation prompt instructs the LLM to: regroup orphaned items under logical parents, merge similar remaining items, reparent misplaced items, and split overly broad items"
  - "Interactive UX: proposals shown to user with y/n/a/q prompts (reuse existing interactive pattern from smartPrune)"
  - "Supports --accept flag to auto-accept all consolidation proposals"
  - "Supports --dry-run to preview both prune targets and consolidation proposals without changes"
  - "New prompt added to reshape-reason.ts as POST_PRUNE_CONSOLIDATION_PROMPT"
  - "Consolidation proposals use full reshape action set (merge, reparent, split, update, obsolete) not just the limited prune subset"
description: "Completed items dominate the PRD display when most work is done, burying active/new items at the bottom. Both the CLI and web UI should default to hiding completed items, with an easy way to show them when needed.\n\n---\n\nAfter archiving completed subtrees, prune should run a reshape pass on remaining items to reconsolidate and regroup them into logical groupings. Currently prune just removes completed items, leaving scattered/orphaned items behind. The new behavior chains a reshape call with a consolidation-focused LLM prompt that can reparent, merge, split, and update remaining items to create a clean, well-organized PRD."
---

# Hide completed items by default in status views

🟠 [completed]

## Summary

Completed items dominate the PRD display when most work is done, burying active/new items at the bottom. Both the CLI and web UI should default to hiding completed items, with an easy way to show them when needed.

---

After archiving completed subtrees, prune should run a reshape pass on remaining items to reconsolidate and regroup them into logical groupings. Currently prune just removes completed items, leaving scattered/orphaned items behind. The new behavior chains a reshape call with a consolidation-focused LLM prompt that can reparent, merge, split, and update remaining items to create a clean, well-organized PRD.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** prune, reshape, rex, status, ux, web
- **Level:** task
- **Started:** 2026-02-10T14:36:17.763Z
- **Completed:** 2026-02-10T14:36:17.763Z
- **Duration:** < 1m
