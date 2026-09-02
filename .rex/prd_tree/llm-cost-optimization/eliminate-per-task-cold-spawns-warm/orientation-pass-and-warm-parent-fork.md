---
id: "649bcd2b-fcbf-4982-b02c-5c780049f63d"
level: "task"
title: "Orientation pass and warm-parent fork wiring"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "sessions"
  - "caching"
blockedBy:
  - "052cfa55-9ea9-46e1-8b00-60a9ee73b555"
source: "ndx-work"
startedAt: "2026-08-31T01:51:52.140Z"
completedAt: "2026-08-31T02:01:38.307Z"
endedAt: "2026-08-31T02:01:38.307Z"
acceptanceCriteria:
  - "ndx work --loop with the fork strategy runs exactly one orientation session and forks it per task"
  - "The orientation session makes no writes and its prompt forbids modification"
  - "The parent session id is persisted and reused across tasks within the TTL"
  - "ndx work --fresh forces a new orientation session"
  - "Non-Claude vendors fall back to cold spawns without error"
  - "Forked task runs record the parent session id on the run record for auditability"
description: "Wire the fork strategy into the run path. Once per loop or repo-state change, run a bounded orientation-only spawn (read the trimmed context, map the layout, confirm build/test commands, note conventions; modifications forbidden) and cache its session id as the parent. Each task then spawns via claude -p --resume <parentId> --fork-session so it inherits orientation with a byte-identical prefix, giving cache-read pricing within the TTL and zero re-exploration turns. Add ndx work --fresh to force a new parent. Vendors without a resume equivalent (codex, google, local) fall back to cold spawns without error."
lastModified: "2026-08-31T02:01:38.312Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
