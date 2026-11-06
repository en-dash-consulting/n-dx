---
id: "183d4e09-623a-44f9-80a3-c05569ef459d"
type: "task"
title: "Plan renders tiles: Inbox, Open changes, Product and Validation"
slug: "plan-renders-tiles-inbox-open-changes"
description: "Replace Plan's sections after the capture bar with tiles, in this order: product (cols 12, rows 2), inbox (cols 4, rows 2, badge \"inbox\"), changes (cols 8, rows 2, labelled Open changes, tabs: [prd]) and validation (cols 6). prd moves to alsoOwns so its route and breadcrumb stay under Plan. On a v1 project the v2-only tiles give way to a prd tile (cols 8, rows 2). The Inbox tile at zero reads \"Inbox is empty\". Keep the Sidecar's page attachment (pageItemFor's `plan` item) and ghost rows working on the new layout."
acceptanceCriteria:
  - "STAGES.plan has the capture bar as its plain section and tiles for product (first, full width), inbox, changes (with a prd tab) and validation"
  - "Opening the Open changes tile full-screen shows List and Tree tabs, and the detail panel opens beside the tree"
  - "A v1 fixture shows a Tasks tile instead of the Inbox, Open changes and Product tiles"
  - "The Sidecar attachment test for the Plan page still resolves the plan item"
  - "The stage-page snapshot and restored-views tests pass"
priority: "high"
source: "ndx-capture"
blockedBy:
  - "51c74eb2-9099-4115-950a-a33f32755dee"
---
