---
id: "0ef8ca7b-7fa8-4f0a-bc49-f10b04272ce7"
level: "task"
title: "Round-trip PRD bundle via ndx prd export / ndx prd import"
status: "pending"
priority: "medium"
tags:
  - "prd"
  - "portability"
  - "cli"
source: "ndx-capture"
acceptanceCriteria:
  - "`rex export --out=<path>` writes a single JSON bundle containing every item in the PRD document, including its `SCHEMA_VERSION`"
  - "Export → import into an empty project reproduces an equivalent tree: ids, hierarchy, level, status, priority, description, acceptanceCriteria, tags, blockedBy, source, and attribution metadata all match the source"
  - "Importing a bundle whose SCHEMA_VERSION is newer than the running rex fails with a clear error and writes nothing"
  - "`--merge` (default) preserves existing items and reports each id collision whose content differs; `--replace` overwrites the tree only after explicit confirmation or `--yes`"
  - "Import performs its tree write inside `store.withTransaction` so it holds the PRD lock and cannot interleave with a concurrent PRD writer"
  - "A round-trip fidelity test exists that exports a multi-epic fixture PRD, imports it into a fresh directory, and asserts field-level equivalence"
description: "Implement the machine round-trip half of the portable bundle: `rex export` serializes the entire loaded PRD document to a single JSON file, `rex import` reconstructs `.rex/prd_tree/` from that file through the normal store write path, and `ndx prd export` / `ndx prd import` spawn them from the orchestrator.\n\nFidelity is the point — a bundle exported on one machine and imported on another must yield an equivalent tree, preserving item ids, parent/child hierarchy, level, status, priority, description, acceptance criteria, tags, `blockedBy` edges, source, and branch/commit attribution metadata. The bundle carries `SCHEMA_VERSION` so a bundle from a newer rex fails loudly rather than importing partially.\n\nImport needs a defined collision policy rather than silent last-writer-wins: `--merge` (default) keeps existing items and reports id collisions with differing content; `--replace` overwrites the tree after confirmation. Import writes under the store transaction lock so it cannot interleave with another PRD writer."
lastModified: "2026-09-08T16:33:58.900Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
