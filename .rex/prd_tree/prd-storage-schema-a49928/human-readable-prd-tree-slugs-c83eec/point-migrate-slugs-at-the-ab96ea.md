---
id: "ab96ea47-bc40-4e2d-8474-a3109fe6a865"
level: "task"
title: "Point migrate-slugs at the readable convention"
status: "completed"
priority: "medium"
blockedBy:
  - "5836feea-95bc-45fd-b94b-1f8a6b44517e"
source: "ndx-capture"
startedAt: "2026-09-02T12:49:10.418Z"
completedAt: "2026-09-02T12:54:06.642Z"
endedAt: "2026-09-02T12:54:06.642Z"
acceptanceCriteria:
  - "`rex migrate-slugs` renames an id-qualified tree to readable slugs and is idempotent on re-run"
  - "Every path change is a pure rename — `git diff -M --name-status` reports R100 with no content deltas"
  - "The command refuses to run, naming the offenders, if any sibling collision remains"
description: "`rex migrate-slugs` already exists as a one-shot idempotent renamer (packages/rex/src/cli/commands/migrate-slugs.ts), currently described as 'Rename the PRD tree to id-qualified slugs' — it is the vehicle that moved the tree to the current convention and is the natural tool pointed the other way. Extend or invert it so the readable rename is one mechanical pass, verifiable as pure renames (git should report R100 for every path), and safe to re-run."
lastModified: "2026-09-02T12:54:06.648Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
