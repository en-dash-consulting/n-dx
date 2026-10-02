---
id: "c09c1832-2c37-4cfc-9c25-667cebb84166"
level: "task"
title: "Rename the Live strip's \"Agent slots\" tile to \"Hench slots\""
status: "pending"
priority: "low"
tags:
  - "live"
  - "local-testing"
source: "local testing of PR #496, 2026-10-01"
acceptanceCriteria:
  - "The tile reads \"Hench slots · this machine\" behind the hub and \"Hench slots · this repository\" standalone (unit test)."
  - "No user-facing string says \"Agent slots\"; the API field machine.slots and its type are unchanged."
  - "Changeset for @n-dx/web (patch)."
description: "The Live machine strip's first tile is labelled \"Agent slots · this machine\" / \"Agent slots · this repository\" (`packages/web/src/viewer/views/live-model.ts:192`). Every slot it counts is a hench run, and both caps are hench's (`guard.maxConcurrentProcesses`) or the hub's cap on hench sessions, so call it \"Hench slots\". Rename the label in live-model.ts and the two expectations in `packages/web/tests/unit/viewer/live-view.test.ts` (lines 125 and 127), and say \"hench slots\" in the doc comments that describe this tile in `packages/web/src/server/routes-live.ts` (around lines 24, 186, 227 and 687) and `packages/web/src/server/routes-hench.ts` (around line 2917). Do not rename the API field `machine.slots` or any type name. Run git commands bare from the project root (no `cd …&&`, no `git -C`)."
lastModified: "2026-10-02T01:10:18.581Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
