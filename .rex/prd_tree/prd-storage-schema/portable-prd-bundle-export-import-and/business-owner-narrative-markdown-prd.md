---
id: "603781ad-06e5-4809-a813-e9fc43bf3d51"
level: "task"
title: "Business-owner narrative Markdown PRD export"
status: "completed"
priority: "medium"
tags:
  - "prd"
  - "documentation"
  - "cli"
  - "export"
blockedBy:
  - "0ef8ca7b-7fa8-4f0a-bc49-f10b04272ce7"
source: "ndx-capture"
startedAt: "2026-09-09T13:26:49.023Z"
completedAt: "2026-09-09T13:51:31.229Z"
endedAt: "2026-09-09T13:51:31.229Z"
acceptanceCriteria:
  - "`ndx prd export --format=narrative --out=<path>` writes prose Markdown; the default format remains the JSON bundle"
  - "Rendered output contains no item uuids, folder slugs, or raw status/priority enum values anywhere in the document body"
  - "Epics render as sections with goal and rationale prose; features render as described capabilities; acceptance criteria render as readable sentences under a plain-language heading"
  - "`--item=<id-or-slug>` limits the render to that item's subtree, and an unknown id fails with a clear error"
  - "Completed and deleted items are excluded by default, with a flag to include completed work for a retrospective-style document"
  - "A snapshot test asserts the narrative output of a fixture PRD contains no uuid-shaped strings and no enum status tokens"
  - "Documentation states that narrative output is one-way and points to the JSON bundle for round-tripping"
description: "Add a narrative rendering mode to `ndx prd export` that emits prose Markdown instead of the transport bundle — the PRD as a business owner would write it for a stakeholder doc, not as a task tracker dump.\n\nThe output drops every internal artefact: no uuids, no folder slugs, no `status: pending` codes, no `blockedBy` id lists. Epics become document sections with a stated goal and rationale; features become described capabilities in plain language; acceptance criteria become readable sentences under a \"How we'll know it's done\" heading. Dependencies, where they matter to a reader, are expressed as sequencing prose (\"this follows on from ...\") rather than id references.\n\nScoping matters as much as tone: `--item=<id-or-slug>` renders a single epic or feature subtree so one initiative can be handed to a stakeholder without the other thousand items. This output is deliberately one-way — it is not re-importable; the JSON bundle from the sibling task is the round-trip surface.\n\nBlocked by the bundle task because it shares the `ndx prd export` command surface and flag parsing."
lastModified: "2026-09-09T13:51:31.236Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
