---
id: "cdca501f-3694-44c9-af19-ef9feeb4be59"
level: "task"
title: "Every PRD write renames hundreds of tree files — slug naming does not round-trip"
status: "pending"
priority: "high"
tags:
  - "e2e-finding"
  - "prd-tree"
  - "slug-naming"
  - "severity:high"
source: "ndx-capture"
acceptanceCriteria:
  - "Determined which naming form is canonical: <slug>-<6hex> or the untruncated bare slug"
  - "A load-then-save cycle with no content change produces zero file renames and an empty git diff"
  - "A single-item status change touches only that item's index.md and its ancestors' rollups"
  - "A regression test asserts save(load(tree)) is a filesystem no-op"
  - "Interaction with the rex-prd merge driver is checked, since a rename storm on both merge sides is the worst case"
description: "A single MCP write to the PRD produces a 900+ file diff that is almost entirely renames. Reproduced three times today, each from an unrelated write: one update_task_status (762 deleted / 171 untracked / 40 modified), the hench run 60c3a951 (801 files committed as \"chore(prd): commit PRD tree changes\"), and a batch of 11 add_item calls (762 deleted / 183 untracked / 41 modified).\n\nThe two naming forms differ by the id suffix and by truncation. On disk:\n  cli-developer-tools-9af1c8/ansi-color-output-across-rex-c513f2/apply-color-formatting-to-rex-0225e4.md\nWritten by the store:\n  cli-developer-tools-9af1c8/ansi-color-output-across-rex-c513f2/apply-color-formatting-to-rex-cli-output.md\n\nDirectories flip the same way: child-process-cleanup-and-exit-b67648/ becomes child-process-cleanup-and-exit-hygiene/, cli-robustness-f69ce6/ becomes cli-robustness/. So the reader accepts <slug>-<6hex> but the writer emits an untruncated slug with no id suffix.\n\nNot a one-time migration settling. It recurred after two separate commits (6a6ba0a3, 59163d61) had already captured the writer's output, so the round trip is genuinely unstable rather than converging. HEAD is \"complete the PRD tree slug migration missed by the #343 squash\", which suggests this migration is still unfinished rather than newly broken.\n\nWhy it matters beyond noise: it makes every PRD change unreviewable in git, it will collide badly with the rex-prd merge driver and the git-first collaboration work (a rename storm on both sides of a merge), and it caused a real scare during this session — the churn looked like mass data loss until item counts confirmed 972 before and after.\n\nNot yet diagnosed: whether the reader normalizes names on load, whether only touched subtrees are rewritten, or which of the two forms is intended to be canonical. Establish that first — the fix depends on it."
lastModified: "2026-08-27T16:52:40.087Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
