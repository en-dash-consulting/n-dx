---
id: "fea07c28-af09-4696-9999-18eb37be4fc6"
level: "feature"
title: "ndx plan Post-LLM Progress Feedback"
status: "completed"
source: "smart-add"
startedAt: "2026-04-09T17:58:55.309Z"
completedAt: "2026-04-09T17:58:55.309Z"
acceptanceCriteria: []
description: "After `ndx plan` prints 'Done.' and 'Vendor: ...' (which marks the end of the LLM response stream), the process appears to stall with no visible output while it processes the response and builds proposals. Users cannot distinguish a working pipeline from a hung process."
---

# ndx plan Post-LLM Progress Feedback

 [completed]

## Summary

After `ndx plan` prints 'Done.' and 'Vendor: ...' (which marks the end of the LLM response stream), the process appears to stall with no visible output while it processes the response and builds proposals. Users cannot distinguish a working pipeline from a hung process.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add spinner and stage labels to ndx plan output between LLM response and proposal display | task | completed | 2026-04-09 |
| Trace ndx plan output flow and identify the silent gap after 'Done.' | task | completed | 2026-04-09 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-09T17:58:55.309Z
- **Completed:** 2026-04-09T17:58:55.309Z
- **Duration:** < 1m
