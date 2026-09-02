---
id: "29e95bbb-1741-4d7f-b608-19930e6e05d6"
level: "feature"
title: "Loop Consecutive-Failure Auto-Cancellation"
status: "completed"
source: "smart-add"
startedAt: "2026-05-26T14:07:03.773Z"
completedAt: "2026-05-26T14:07:03.773Z"
endedAt: "2026-05-26T14:07:03.773Z"
acceptanceCriteria: []
description: "When hench runs in --loop mode, track consecutive run failures and automatically terminate the loop after 3 consecutive failures. A single success resets the counter. This prevents unattended loops from spinning indefinitely on a broken state, wasting tokens and leaving the PRD in a bad state."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression tests for --loop consecutive-failure auto-cancellation](./add-regression-tests-for-loop-c9c56d.md) | completed |
| [Implement consecutive-failure counter and 3-strike auto-cancel in --loop mode](./implement-consecutive-failure-51d7e3.md) | completed |
