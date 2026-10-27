---
id: "caf9107a-de88-4cdd-be66-649219db5d0d"
type: "change"
title: "Fill capability codeFiles from .sourcevision output"
slug: "fill-capability-codefiles-from"
intent: "No capability in the 2026-10-09 migration run has codeFiles, although the spec drafter already accepts them (packages/rex/src/migrations/v1-to-v2/capability-spec.ts) and no caller supplies them. Add a reader that builds the codeFiles map from .sourcevision output (zones.json and the files a capability's tests exercise) and pass it to the drafter. Rex reads the files, as analyze/scanners.ts already does; it never imports sourcevision. Keep the map in the plan: storing codeFiles on capabilities would add to the soft-frozen schema. Background: workshop rex-improvements.md RX17."
acceptanceCriteria:
  - "The reader builds a capability-to-codeFiles map from a .sourcevision fixture and the drafter's specs carry it (test)"
  - "With no .sourcevision directory the reader returns an empty map and the plan is unchanged (test)"
  - "No rex source file imports from sourcevision (the domain-isolation test still passes)"
touches:
  - "3f1ff1cf-7238-4bad-88ca-e1caf9360890"
priority: "medium"
tags:
  - "rex"
  - "migration"
  - "bootstrap"
  - "rx17"
source: "overnight-side-session"
---
