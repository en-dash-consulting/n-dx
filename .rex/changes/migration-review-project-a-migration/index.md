---
id: "d2081c59-9b1a-4b37-bc05-c9d09b5d28cc"
type: "change"
title: "Migration review: project a migration plan file into Graview for people to approve"
slug: "migration-review-project-a-migration"
intent: "Proposed by Ryan in the #647 review. Project a PR 13 migration plan file (`ndx-migration-plan` v1) into the Graview input files, so a person, or two people on a call, can review the proposed product layer and approve it. Reuses the adapter's emit, spawn and serve plumbing and its product kinds, and adds a migration review module to the declaration: fields for each proposal's source, a named confidence per question (placement, kind, job-shaped, spec), held, the suggested place and its runners-up, and the review decision; acts accept, place elsewhere, leave in the Inbox, merge, split; rules listing what still needs deciding; an approval gate that passes only when every area and held change is decided. Decisions export to a reviewed-plan file keyed by v1 item id, which PR 23's apply reads. Nothing writes rex during review. The 2026-10-09 full-tree dry run is the fixture; the design workshop's v4 declaration and plan-to-bundle converter are the starting point."
acceptanceCriteria:
  - "`ndx graview emit --plan <plan.json> .` writes a document and snapshot for every area, capability, constraint and change in the plan, and a fit check on the pair passes on the 2026-10-09 dry run (1,398 records)"
  - "Every proposal shows its source and a confidence that names what it is about; a held change with no suggestion offers \"place\" or \"leave in the Inbox\", never \"accept\""
  - "No decision drops a v1 item: rejecting a placement leaves the change in the Inbox with needsPlacement"
  - "Approving the plan is refused while any area or held change is undecided"
  - "Decisions export to a reviewed-plan file outside .rex/, keyed by v1 id, and a re-emit after a plan re-run keeps decisions for unchanged entries"
  - "Nothing under the rex, sourcevision or hench directories is written by any step of the review"
touches:
  - "1fadb108-b5a8-405c-8699-bdba069663fc"
priority: "medium"
tags:
  - "graview"
  - "migration"
source: "pr-review:#647"
---
