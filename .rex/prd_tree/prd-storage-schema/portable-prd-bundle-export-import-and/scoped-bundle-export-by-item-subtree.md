---
id: "b00afceb-7151-485e-bb0a-35b20c615256"
level: "task"
title: "Scoped bundle export by item — subtree and dependency closure"
status: "completed"
priority: "medium"
tags:
  - "prd"
  - "portability"
  - "cli"
  - "export"
blockedBy:
  - "0ef8ca7b-7fa8-4f0a-bc49-f10b04272ce7"
source: "ndx-work"
startedAt: "2026-09-09T13:55:39.617Z"
completedAt: "2026-09-09T14:08:47.322Z"
endedAt: "2026-09-09T14:08:47.322Z"
acceptanceCriteria:
  - "`rex export --item=<id-or-slug> --out=<path>` writes a bundle containing the named item, every descendant beneath it, and the transitive `blockedBy` closure"
  - "Every id referenced by a `blockedBy` edge in the bundle resolves to an item present in the same bundle — no dangling dependency edges"
  - "The ancestor chain is included so import reconstructs the subtree at its original depth rather than re-parenting it to the root"
  - "The export summary reports the requested subtree and the closure-pulled items separately, so the operator sees what the scope dragged along"
  - "`--item` resolves a folder slug and a uuid to the same item; an unknown value fails with a clear error and writes nothing"
  - "A test exports a mid-tree feature whose task is `blockedBy` an item in another epic, and asserts the blocker plus the ancestor containers are present in the bundle"
  - "Round-trip of a scoped bundle into an empty project yields the subtree with hierarchy and dependency edges intact"
description: "Add `--item=<id-or-slug>` to the bundle exporter so a single epic or feature can be carried between machines without exporting the whole PRD.\n\nScoping is a closure problem, not a filter. Selecting an item pulls **all of its sub-items** — the full descendant chain (epic → features → tasks, including the subtask sections encoded inside a task's `index.md`) — so the fragment stands on its own rather than arriving as a childless stub.\n\nIt must also pull **everything the selection needs**. A task inside the subtree may be `blockedBy` an item in a different epic; a bundle that keeps the edge but omits the target imports into a tree with a dangling dependency, and a bundle that silently drops the edge loses sequencing information. So the export walks the transitive `blockedBy` closure and includes those items too, plus the ancestor containers required to place the subtree at its original depth on import.\n\nBecause the closure can reach well past what the operator asked for, the export summary distinguishes the requested subtree from what the closure dragged in — a scoped export that quietly grows to half the PRD should say so.\n\nSits on top of the round-trip task, which owns the bundle format, the `--out` flag parsing, and the import-side merge policy."
lastModified: "2026-09-09T14:08:47.329Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
