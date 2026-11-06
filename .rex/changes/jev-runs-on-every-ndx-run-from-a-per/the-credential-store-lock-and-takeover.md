---
id: "e687795c-97ff-4bb5-8cd0-820e59b2d555"
type: "task"
title: "The credential store lock and takeover guard are created filled, so no age rule removes a live lock"
slug: "the-credential-store-lock-and-takeover"
description: "#956 review S2 (issue comment 6672622190). packages/llm-client/src/credential-store.ts: tryCreateLock (:991) opens the lock with openSync(..., 'wx') and fills it with a separate writeSync, and lockIsStale (:1048) calls an unreadable lock stale once EMPTY_LOCK_STALE_MS (5 s) old. A writer paused between open and write (laptop sleep, SIGSTOP, swap) has its lock removed by another writer, both run fn, and one credential update is lost with no error. The takeover guard is also created empty and reclaimAbandonedGuard (:1087) deletes it by age alone, so a writer paused inside the guard section can have a live lock removed. A network ndx home whose clock lags makes every new lock look old. Fix as the review suggests: create the lock and the guard already filled, by writing <path>.<uuid>.tmp and linkSync to the real path (atomic EEXIST); reclaim the guard only when its recorded PID is dead; keep the age rule only for an empty lock an older version left. Tests use injected seams and a temp ndx home; never a real store."
acceptanceCriteria:
  - "A lock or guard file is never visible empty: it is written to a temp path and linked into place, and a link that hits EEXIST counts as held (unit test)"
  - "The guard records its holder's PID and is reclaimed only when that PID is dead, never by age (unit test with a live and a dead PID)"
  - "An empty lock left by an older version is still reclaimed after EMPTY_LOCK_STALE_MS, and a filled lock with a live PID is never removed however old (unit test with an injected clock)"
  - "The cross-process writers test still loses no update"
priority: "high"
source: "pr-956-review"
---
