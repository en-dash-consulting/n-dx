---
id: "ab96ea47-bc40-4e2d-8474-a3109fe6a865"
type: "change"
title: "Point migrate-slugs at the readable convention"
slug: "point-migrate-slugs-at-the-readable"
intent: "`rex migrate-slugs` already exists as a one-shot idempotent renamer (packages/rex/src/cli/commands/migrate-slugs.ts), currently described as 'Rename the PRD tree to id-qualified slugs' — it is the vehicle that moved the tree to the current convention and is the natural tool pointed the other way. Extend or invert it so the readable rename is one mechanical pass, verifiable as pure renames (git should report R100 for every path), and safe to re-run."
acceptanceCriteria:
  - "`rex migrate-slugs` renames an id-qualified tree to readable slugs and is idempotent on re-run"
  - "Every path change is a pure rename — `git diff -M --name-status` reports R100 with no content deltas"
  - "The command refuses to run, naming the offenders, if any sibling collision remains"
touches:
  - "c83eecc7-a23e-4a3e-aeee-fc022dea0fc1"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "5836feea-95bc-45fd-b94b-1f8a6b44517e"
---
