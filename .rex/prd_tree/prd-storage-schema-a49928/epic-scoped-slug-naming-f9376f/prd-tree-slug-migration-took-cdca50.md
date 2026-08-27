---
id: "cdca501f-3694-44c9-af19-ef9feeb4be59"
level: "task"
title: "PRD tree slug migration took three full-document saves to converge"
status: "pending"
priority: "medium"
tags:
  - "e2e-finding"
  - "prd-tree"
  - "slug-naming"
  - "severity:medium"
source: "ndx-capture"
acceptanceCriteria:
  - "Established why the migration needed three full-document saves rather than one"
  - "Confirmed whether a save rewrites the whole tree or only loaded subtrees, and documented which"
  - "Verified that a fresh clone of the repo does not reproduce a large rename diff on its first PRD write"
  - "Any remaining pre-migration <slug>-<6hex> names in the tree are identified, or their absence confirmed"
  - "A migration-scale rewrite is distinguishable from data loss in whatever the operator sees"
description: "CORRECTED after further evidence. Originally filed as \"slug naming does not round-trip\", claiming the write path was permanently unstable. That claim was wrong and is retracted — the churn converged.\n\nWhat was observed: three consecutive PRD writes each produced a ~900-file diff, almost entirely renames between two naming forms. On disk, cli-developer-tools-9af1c8/.../apply-color-formatting-to-rex-0225e4.md; written by the store, .../apply-color-formatting-to-rex-cli-output.md. Directories flipped the same way (child-process-cleanup-and-exit-b67648 to child-process-cleanup-and-exit-hygiene). So the reader accepts <slug>-<6hex> while the writer emits an untruncated bare slug.\n\nThe churn appeared across commits 6a6ba0a3 (801 files), 59163d61 (801 files, written by hench run 60c3a951), and 4b1a5c00 (762 deleted / 183 added). After those three, a batch of three PRD writes touching two items produced exactly three changed files — proportional and correct. The write path is therefore stable now; what looked like instability was an incomplete migration finishing in stages. HEAD before all this was \"complete the PRD tree slug migration missed by the #343 squash\", which is consistent.\n\nWhat remains worth answering rather than closing outright:\n1. Why three separate full-document saves were needed instead of one. If a save only rewrites the subtree it loaded, a partial migration can persist indefinitely until every branch happens to be touched — which is what appears to have happened, and would recur on any repo still carrying pre-migration names.\n2. Whether a fresh clone is stable, or whether a first write there reproduces the ~900-file diff.\n3. The operator experience: a single status change producing 762 deletions read as mass data loss during this session and took an item-count comparison (972 before, 972 after) to disprove. Anything that makes a migration rewrite legible as a migration would prevent that.\n\nDowngraded from high to medium: the merge-driver collision risk that motivated the original priority is historical now that the tree has converged."
lastModified: "2026-08-27T17:14:59.491Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
