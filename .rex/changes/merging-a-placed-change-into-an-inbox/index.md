---
id: "cf0c6e49-226b-4876-8e78-062226933e54"
type: "change"
title: "Merging a placed change into an Inbox change keeps the result placed"
slug: "merging-a-placed-change-into-an-inbox"
intent: "Holistic review of the combined v2 stack, 2026-10-13 (rex area, should-fix, CONFIRMED by reproduction).\n\nDefect: packages/rex/src/core/merge.ts mergeChanges (around :204-215) and carryTouches (:153). carryTouches copies an absorbed change's confirmed targets (touches) onto the target, but nothing looks at needsPlacement. When the surviving target is an Inbox change (needsPlacement: true) and a source was placed, the result has touches, still carries needsPlacement, and holds the placed change's tasks. Selection (#690) skips everything under an Inbox change, and #716's writer moves the whole change into changes/inbox/.\n\nScenario (reproduced): placed change \"Saved cards\" (touches A1.1) with task \"Store the token\"; an Inbox duplicate \"Remember my card\". merge_items {sourceIds:[placed, inbox], targetId: inbox}. Before: actionable [Wire the button, Store the token]; after: [Wire the button]. The target reads needsPlacement: true, touches: [\"A1.1\"], and its files move to changes/inbox/remember-my-card/. A task in flight under a claim drops out of get_next_task. Every v2 merge reaches this code: MCP merge_items, reorganize's merge proposals, reshape's merges and the dashboard merge (#693).\n\nFix: when any source is placed (no needsPlacement) and the target still needs placement, clear the target's needsPlacement in the same merge, because the carried touches are confirmed targets; record nothing else new. A merge where every change needs placement keeps the flag. No test today covers a merge or move across the Inbox boundary."
acceptanceCriteria:
  - "On a v2 copy, merge_items of a placed change (with a task) into an Inbox change leaves the target without needsPlacement, its task still selected by get_next_task, and its files outside changes/inbox/ (test that fails on the current head)"
  - "A merge whose changes all need placement keeps the target in the Inbox (test)"
  - "The same rule holds through reorganize's and reshape's merges, which go through mergeChanges (test or shared-helper assertion)"
  - "v1 merges are unchanged; existing merge tests pass unedited"
touches:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
priority: "high"
tags:
  - "pr-33"
  - "review-2026-10-13"
  - "lane-rex-store"
source: "review-2026-10-13"
---
