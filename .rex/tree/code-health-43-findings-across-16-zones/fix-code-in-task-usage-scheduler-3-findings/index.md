---
id: "05826b41-581b-4485-98af-892996fc5620"
level: "feature"
title: "Fix code in task-usage-scheduler (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:32:07.551Z"
completedAt: "2026-04-14T01:32:07.551Z"
acceptanceCriteria: []
description: "- start.ts satisfies RegisterSchedulerOptions by passing a concrete options literal, but no compile-time satisfies assertion or assignability check enforces this at the definition site. Interface drift (a new required callback added to RegisterSchedulerOptions, a changed callback signature) will produce a type error only at the call site in start.ts — not in register-scheduler.test.ts, which uses mocks. A `satisfies RegisterSchedulerOptions` annotation on the options literal in start.ts would surface drift at the definition site where it is easier to fix.\n- Add 'satisfies RegisterSchedulerOptions' to the options literal passed to registerScheduler in packages/web/src/server/start.ts. This one-line change surfaces interface drift at the injection site — the exact location where a new required callback would be missed — rather than only at the TypeScript structural check for the function call itself.\n- Add a behavioral contract test to register-scheduler.test.ts covering: (1) that a callback throwing an error does not prevent subsequent callbacks from being called in the same tick, and (2) that a loadPRD callback that delays longer than the interval does not cause overlapping tick execution. These are the two most likely production failure modes for the scheduler and cannot be caught by interface compliance alone."
recommendationMeta: "[object Object]"
---

# Fix code in task-usage-scheduler (3 findings)

🟠 [completed]

## Summary

- start.ts satisfies RegisterSchedulerOptions by passing a concrete options literal, but no compile-time satisfies assertion or assignability check enforces this at the definition site. Interface drift (a new required callback added to RegisterSchedulerOptions, a changed callback signature) will produce a type error only at the call site in start.ts — not in register-scheduler.test.ts, which uses mocks. A `satisfies RegisterSchedulerOptions` annotation on the options literal in start.ts would surface drift at the definition site where it is easier to fix.
- Add 'satisfies RegisterSchedulerOptions' to the options literal passed to registerScheduler in packages/web/src/server/start.ts. This one-line change surfaces interface drift at the injection site — the exact location where a new required callback would be missed — rather than only at the TypeScript structural check for the function call itself.
- Add a behavioral contract test to register-scheduler.test.ts covering: (1) that a callback throwing an error does not prevent subsequent callbacks from being called in the same tick, and (2) that a loadPRD callback that delays longer than the interval does not cause overlapping tick execution. These are the two most likely production failure modes for the scheduler and cannot be caught by interface compliance alone.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Fix code in task-usage-scheduler: start.ts satisfies RegisterSchedulerOptions by passing a concrete options litera (+2 more) | task | completed | 2026-04-14 |

## Info

- **Status:** completed
- **Priority:** high
- **Level:** feature
- **Started:** 2026-04-14T01:32:07.551Z
- **Completed:** 2026-04-14T01:32:07.551Z
- **Duration:** < 1m
