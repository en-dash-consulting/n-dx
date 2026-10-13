---
id: "a81620ea-58c3-4332-96b2-2d6d5d80307c"
level: "task"
title: "Small projection gaps: overlapping sibling zones, sub-zone crossings, proposed-area notes, stale zone descriptions"
status: "pending"
priority: "low"
tags:
  - "graview"
source: "notepad:graview-run"
acceptanceCriteria:
  - "A file listed by two sibling zones lands in one zone by a stated rule, with a test"
  - "Crossings between sub-zones are projected at every depth"
  - "A proposed area carries its notes as a field the area page shows"
  - "The face says a zone's file count from its own data where the description disagrees, or the description is refreshed by sourcevision"
description: "From the graview run's notepad and the 2026-10-12 face review. In sources/code.ts two sibling zones listing one file resolve to whichever comes later in zones.json, and subCrossings are read for top-level zones only. ProposedArea.notes (what a reviewer should look at) is not projected, though the face could show it on an area page. A zone's description is sourcevision's enrichment text and can disagree with its own numbers (rex-cli's says 141 files beside its 197), and it repeats names (\"imports Rex Store and Rex Store\")."
lastModified: "2026-10-13T00:05:05.237Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
