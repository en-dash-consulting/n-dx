---
id: "97d7228b-d4f4-452e-9f5a-dcaeb2d92ae0"
level: "feature"
title: "Auto-Commit Timer-Expiry Stall Recovery in --loop/--yes Mode"
status: "completed"
source: "smart-add"
startedAt: "2026-05-27T18:40:08.400Z"
completedAt: "2026-05-27T18:40:08.400Z"
endedAt: "2026-05-27T18:40:08.400Z"
acceptanceCriteria: []
description: "When hench runs with --yes/--auto/--loop, a timer-expiry auto-commit ('Auto-commit: committed staged changes (timer expiry)') can stall the loop instead of advancing to the next task. The loop must recognize this event as a successful commit and proceed — either continuing from the committed state or skipping to the next task if the work is already fully committed."
---

## Children

| Title | Status |
|-------|--------|
| [Diagnose timer-expiry auto-commit stall path in hench loop and identify blocking call site](./diagnose-timer-expiry-auto-3e8c3c.md) | completed |
| [Fix hench loop to treat timer-expiry auto-commit as a successful commit and advance to next task](./fix-hench-loop-to-treat-timer-e5c37f.md) | completed |
