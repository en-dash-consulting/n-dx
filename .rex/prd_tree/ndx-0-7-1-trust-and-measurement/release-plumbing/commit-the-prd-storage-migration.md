---
id: "b64092df-25ba-477e-b5bd-1f0cdb2b426c"
level: "task"
title: "Commit the PRD storage migration design document"
status: "pending"
priority: "low"
tags:
  - "0.7.1"
  - "release-plumbing"
  - "wm-2038"
  - "non-code"
source: "caos work management: WM2038 (Commit the PRD storage migration design document); 0.7.1 execution plan PR group"
acceptanceCriteria:
  - "The document is on main under docs/process/ and linked from the docs index."
  - "Its header records the commit it was grounded on and that it is a proposal pending the 1.0.0 epic."
  - "The docs site build (.github/workflows/docs.yml) passes."
description: "docs/process/prd-storage-v2-migration.md specifies the 1.0.0 PRD storage format (per-folder state.yaml, frozen slugs, the rex migrate command, compatibility table, work items and dependencies). It exists only as an untracked file in one checkout. Because it specifies a file format and a command that later releases must implement exactly, it belongs in the repository; the roadmap and dashboard design documents do not, because their content now lives in the work management system.\n\nImplementation notes: Open a chore branch, add docs/process/prd-storage-v2-migration.md as it exists in the maintainer's main checkout (ask for the file if it is not present), add a link to it from the docs index page and from docs/architecture/prd-folder-tree-schema.md ('planned v2 format'), and open a docs-only PR. Do not edit the document's content beyond the header line stating its grounding commit and status. No changeset for docs."
lastModified: "2026-09-21T17:24:11.232Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
