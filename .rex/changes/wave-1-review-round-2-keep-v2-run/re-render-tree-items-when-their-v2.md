---
id: "164f50d0-e7e5-4ee6-9878-9bbf41640ea9"
type: "task"
title: "Re-render tree items when their v2 execution flags change"
slug: "re-render-tree-items-when-their-v2"
description: "PR #1002 review comment https://github.com/en-dash-consulting/n-dx/pull/1002#discussion_r4558509112. diffItems in packages/web/src/viewer/components/prd-tree/tree-differ.ts compares only SCALAR_KEYS, tags, blockedBy and criteria, so executionEligible, executionRefusal and runsAsOneTask (which depend on ancestor and product state) stay stale: placing an Inbox change leaves Start hidden on its tasks until reload, and completing or applying a change leaves Start on tasks whose click then returns 400."
acceptanceCriteria:
  - "A tree refresh in which only executionEligible, executionRefusal or runsAsOneTask changes produces a new item object, so Start appears or disappears without a reload."
  - "A test covers placing an Inbox change with tasks (Start appears on its tasks) and applying a change (Start disappears)."
priority: "high"
source: "ndx-capture"
---
