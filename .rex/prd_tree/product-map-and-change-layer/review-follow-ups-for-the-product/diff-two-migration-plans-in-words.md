---
id: "1d830b94-da1e-46de-a186-3f5cc048837b"
level: "task"
title: "Diff two migration plans in words"
status: "pending"
priority: "medium"
tags:
  - "rex"
  - "migration"
  - "rx13"
source: "overnight-side-session"
acceptanceCriteria:
  - "Diffing two plans lists each moved, added and dropped entry in a sentence (test)"
  - "The summary gives counts per kind, and counts dropped metadata once (test)"
  - "Diffing a plan with itself reports no differences (test)"
description: "Given two migration plan files, report the difference in sentences: what moves, what is dropped (droppedMeta and droppedLog are the corrupt-metadata counts, so name them once), and counts per kind. It sits beside migrations/plan-file.ts and follows the wording of applyAmendmentsProblems. It needs per-entry decisions and hashes from RX5 (PR 23) to tell a changed entry from an unchanged one. The apply --dry-run half of RX13 is in PR 23 and is not part of this item. Background: workshop rex-improvements.md RX13."
lastModified: "2026-10-10T05:16:46.190Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
