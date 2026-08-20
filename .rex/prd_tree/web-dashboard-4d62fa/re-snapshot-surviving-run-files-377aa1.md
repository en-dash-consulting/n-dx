---
id: "377aa1d0-06cb-4fa1-82e9-86dccfeca2a4"
level: "task"
title: "Re-snapshot surviving run files before the no-change short-circuit"
status: "pending"
priority: "medium"
tags:
  - "pr-329-followup"
  - "web"
  - "task-usage"
  - "performance"
source: "PR #329 review comment 3816985312 (ryrykeith)"
acceptanceCriteria:
  - "The re-snapshot loop runs on every scan, including scans with no added/modified/deleted files"
  - "A file first observed inside the mtime-granularity window drops its contentHash once its mtime ages past the window, returning to the stat-only path"
  - "The no-change short-circuit still avoids the contribution subtract/re-read work when nothing changed"
  - "A test asserts a quiet poll following an in-window observation clears the carried hash"
description: "PR #329 review follow-up (unresolved comment on packages/web/src/server/task-usage/incremental-task-usage.ts:296).\n\nThe comment at lines 296-300 states the intent precisely: re-snapshot EVERY surviving file, because an unchanged file still needs its freshness re-evaluated — once its mtime ages past the granularity window the hash is dropped and it returns to the stat-only path, and keeping the old snapshot would pin it as forever-fresh and hash it on every scan.\n\nThat loop (line 301) sits *after* the no-change short-circuit at line 269, which returns early on any poll where nothing was added, modified, or deleted — the common case. So the re-evaluation never happens on quiet polls, and the pinning the comment warns about is exactly what occurs: a file first observed inside the mtime-granularity window keeps `mtimeMayBeShared` set and gets re-hashed on every poll indefinitely, instead of aging out to the cheap stat-only comparison.\n\nMoving the re-snapshot loop above the short-circuit fixes it."
---
