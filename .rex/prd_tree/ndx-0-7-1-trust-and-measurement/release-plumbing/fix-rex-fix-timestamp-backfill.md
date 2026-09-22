---
id: "7a9003a8-eb2a-4122-a325-15e26c3565a0"
level: "task"
title: "Fix rex fix timestamp backfill inverting startedAt/completedAt (#375)"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "rex"
  - "data-integrity"
  - "gh-375"
source: "Triage decision on GitHub issue #375 (2026-09-22): fix now in 0.7.1 rather than defer to the 0.9.0 single state writer; assigned to endash-shal"
acceptanceCriteria:
  - "rex fix never produces startedAt > completedAt on any item it touches."
  - "A completed item missing startedAt is repaired without using the current clock as its start time (clamp or leave-absent, with the choice recorded in the fix report)."
  - "Regression test covers the inversion case and the both-absent case."
  - "GitHub issue #375 is closed with a comment naming the fixing commit and test."
description: "applyTimestampFixes in packages/rex/src/fix/index.ts stamps startedAt = now on a completed item whose completedAt is the real, earlier time, yielding startedAt > completedAt — the repair manufactures data it cannot know. When both timestamps are absent, both become now, fabricating a zero-length interval. The true start time is unrecoverable, so the fix must stop inventing it: a completed item missing startedAt should either derive a non-inverting value (e.g. clamp to completedAt) or leave the field absent and report it, never backfill with the current clock."
lastModified: "2026-09-22T16:00:51.110Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
