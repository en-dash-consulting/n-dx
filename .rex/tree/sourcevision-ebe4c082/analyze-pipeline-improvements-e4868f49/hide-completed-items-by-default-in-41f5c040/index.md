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

## Subtask: Default to hiding completed items in CLI status and web PRD tree

**ID:** `2be4350b-29a7-4249-b640-3b0201f51ce1`
**Status:** completed
**Priority:** high

Two changes to default completed items to hidden:

1. **CLI status** (packages/rex/src/cli/commands/status.ts):
   - Add filtering to renderTree: before rendering, filter out items where status === "completed" AND all children are also completed (same logic as isFullyCompleted from core/prune.ts). Items that are completed but have non-completed children should still show (with their non-completed children visible).
   - Add --all flag: when present, skip the filtering and show everything (current behavior).
   - Update the stats summary line to note when completed items are hidden, e.g. "3 pending, 2 in progress — 80% complete (showing active items, use --all for full tree)"
   - Update help text in constants.ts.

2. **Web PRD tree** (packages/web/src/viewer/components/prd-tree/status-filter.ts):
   - Change defaultStatusFilter() to return the "Active Work" set: new Set(["pending", "in_progress", "blocked"]) instead of the current all-except-deleted set.
   - The existing filter UI already supports switching to "All Items" — no other web changes needed.

Key files to modify:
- packages/rex/src/cli/commands/status.ts (add filtering logic + --all flag)
- packages/rex/src/cli/commands/constants.ts (update help text)
- packages/web/src/viewer/components/prd-tree/status-filter.ts (change defaultStatusFilter return value)

**Acceptance Criteria**

- renderTree in status.ts filters out fully-completed subtrees by default
- Items with mixed children (some completed, some not) still show with non-completed children
- --all flag shows all items including completed (preserves current behavior)
- Stats summary indicates when completed items are hidden
- Help text updated in constants.ts for new --all flag
- defaultStatusFilter() in status-filter.ts returns Active Work set by default
- Web UI filter presets still work correctly with new default
- All existing tests pass

---

## Subtask: Chain reshape consolidation pass after prune archiving in cmdPrune

**ID:** `2a2f6c59-ba4d-41a3-84b6-a64facbed3d4`
**Status:** completed
**Priority:** high

Modify packages/rex/src/cli/commands/prune.ts to add a consolidation phase after the existing prune step. Implementation plan:

1. In reshape-reason.ts, add a new POST_PRUNE_CONSOLIDATION_PROMPT constant. This prompt should instruct the LLM to analyze remaining (non-completed) PRD items and propose regrouping: reparent orphaned items under logical parent epics/features, merge similar scattered items, split overly broad items into focused children, and update stale titles/descriptions. Use the full reshape action set (merge, reparent, split, update, obsolete). The prompt should emphasize creating clean logical groupings rather than just cosmetic changes.

2. In reshape-reason.ts, add a new option to ReshapeReasonOptions: `consolidateMode?: boolean`. When true, use the new consolidation prompt instead of RESHAPE_SYSTEM_PROMPT or SMART_PRUNE_PROMPT.

3. In prune.ts cmdPrune function, after the existing prune-and-archive step (line ~105), add the consolidation phase:
   - Load Claude config (same pattern as smartPrune)
   - Call reasonForReshape(doc.items, { dir, model, consolidateMode: true })
   - If proposals returned, show them interactively (reuse the interactive pattern from interactiveSmartPrune, or extract to shared helper)
   - Apply accepted proposals via applyReshape()
   - Archive any items removed during consolidation
   - Save document and log the action

4. Gate the consolidation behind behavior: always run consolidation after prune (it will be a no-op if the LLM finds nothing to consolidate). Support --no-consolidate flag to skip it. Support --accept to auto-accept consolidation proposals. In --dry-run mode, show both what would be pruned AND what consolidation proposals would be made.

Key files to modify:
- packages/rex/src/analyze/reshape-reason.ts (new prompt + consolidateMode option)
- packages/rex/src/cli/commands/prune.ts (chain consolidation after prune)
- packages/rex/src/cli/commands/constants.ts (update help text for prune command)

**Acceptance Criteria**

- POST_PRUNE_CONSOLIDATION_PROMPT exists in reshape-reason.ts with clear instructions for regrouping remaining items
- consolidateMode option added to ReshapeReasonOptions and wired through reasonForReshape
- cmdPrune chains consolidation after archiving completed items
- Interactive proposal acceptance works (y/n/a/q pattern)
- --accept auto-accepts consolidation proposals
- --dry-run previews both prune targets and consolidation proposals
- --no-consolidate flag skips the reshape pass
- Help text in constants.ts updated to reflect new prune behavior
- All existing prune tests still pass
- Consolidation uses full reshape action set (merge, reparent, split, update, obsolete)

---

## Subtask: Suppress deleted items from rex status CLI output by default

**ID:** `1cf7f490-d6e1-4232-bb90-c9fcbe06a6af`
**Status:** completed
**Priority:** medium

Deleted items clutter the rex status tree and provide no actionable signal to the user. The status command should omit items with a 'deleted' status from its default output, matching the existing behavior for completed items. A flag (e.g. --show-deleted or --all) should allow users to opt back in if needed.

**Acceptance Criteria**

- Running `rex status` omits all items whose status is 'deleted' from the printed tree
- Omitted deleted items are not counted in completion totals shown in status output
- A CLI flag (--show-deleted or --all) causes deleted items to appear in the output when passed
- JSON output via --format=json respects the same filter by default and includes deleted items when the flag is present
- Behavior is consistent with how completed items are hidden by default

---
