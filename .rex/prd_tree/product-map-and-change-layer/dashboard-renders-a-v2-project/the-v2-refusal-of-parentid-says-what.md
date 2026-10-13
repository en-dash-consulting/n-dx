---
id: "6653f6b0-6f33-48ec-904c-810bc176120d"
level: "task"
title: "The v2 refusal of parentId says what to do instead"
status: "completed"
priority: "medium"
tags:
  - "pr-36"
  - "review-2026-10-12"
  - "lane-web"
source: "review-2026-10-12"
startedAt: "2026-10-13T16:47:40.293Z"
completedAt: "2026-10-13T16:51:00.240Z"
endedAt: "2026-10-13T16:51:00.240Z"
resolutionType: "code-change"
resolutionDetail: "v2 parentId refusal in routes-rex/items.ts now names Add with no parent and rex add --type=task --parent=<id>; route test asserts wording."
acceptanceCriteria:
  - "POST /api/rex/items with a parentId on a v2 copy answers 400 with a message naming Add with no parent and rex add --type=task --parent=<id> (route test asserting the wording)"
  - "No viewer change; the v1 add-under-parent route is unchanged"
description: "Review 2026-10-12, PR #693 should-fix 2 (CONFIRMED: POST {\"title\":\"Child task\",\"parentId\":\"c000…01\",\"level\":\"task\"} → 400).\n\nDefect: packages/web/src/server/routes-rex/items.ts:333 refuses parentId on v2 with \"A v2 project takes a new change in the Inbox, not under a parent\", which does not say what to do instead. The viewer's inline \"+\" (components/prd-tree/prd-tree.ts:489/577, shown on every projected change because changes project as level epic), the detail panel's \"Add child\" (components/prd-tree/task-detail.ts:1195) and the command-bar AddItemForm with a parent chosen all send parentId and always fail on v2.\n\nThe refusal itself is right for the no-break minimum: ChangeLayerStore.addItem(item, parentId) would use a plain insertChild and skip rex's addTask split rule (core/change-add.ts).\n\nFix: keep the refusal, and make the message name the way forward, e.g. \"Adding a task under a change from the dashboard comes with roadmap PR 21. Use Add with no parent for an Inbox change, or `rex add --type=task --parent=<id>` (or MCP add_item).\" Hiding the viewer's \"+\" and \"Add child\" on v2 is left for PR 21; do not change the viewer here."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T16:51:00.994Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
