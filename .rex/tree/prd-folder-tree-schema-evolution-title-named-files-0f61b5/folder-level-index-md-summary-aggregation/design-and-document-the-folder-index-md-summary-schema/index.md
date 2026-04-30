---
id: "5446296c-cb9c-4442-9640-cdc551e2343a"
level: "task"
title: "Design and document the folder index.md summary schema"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "prd"
  - "schema"
  - "docs"
source: "smart-add"
acceptanceCriteria:
  - "Schema document covers every section with field names, source of truth, and regeneration semantics"
  - "Annotated example index.md included for an epic, a feature, and a task folder"
  - "Decision recorded for each section as `regenerated` (overwritten on every write) or `preserved` (round-trip-safe across regeneration)"
  - "Schema reviewed against existing PRDStore data model — every field has a backing source"
  - "Linked from CLAUDE.md and AGENTS.md sections that describe folder-tree storage"
description: "Specify the exact sections, headings, and ordering for the new `index.md` summary file: header block with item identity, completion table (child slug, title, status, last-updated), per-task commit list, prose summary block (sourced from the item description or hench-generated), change list (recent edits), and basic info (priority, tags, branch attribution, dates). Document the schema in `docs/architecture/prd-folder-tree-schema.md` with an annotated example. Decide whether the prose summary is human-edited or fully regenerated."
---
