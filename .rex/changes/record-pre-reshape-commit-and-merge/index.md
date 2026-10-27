---
id: "b6aca952-e7df-46de-96e9-e2cefaff2fcd"
type: "change"
title: "Record pre-reshape commit and merge audit trail (reasoning + old IDs) in archive and CLI output"
slug: "record-pre-reshape-commit-and-merge"
intent: "Before reshape mutates the folder tree, capture the current git HEAD commit hash as a restore point. For each merge performed in the same-parent duplicate pass, append an entry to .rex/archive.json (the existing reshape archive surface) that includes: the survivor item ID, the discarded old item IDs, a short merge-reasoning string (which fields were taken from older vs. newer, child re-parenting summary), and the pre-reshape commit hash. Surface the same information in the reshape CLI output so the operator sees what was merged and how to roll back. If the working tree is not a git repo or HEAD cannot be resolved, fall back to recording 'no-git' and continue (do not block reshape)."
acceptanceCriteria:
  - "Every same-parent merge produces one archive.json entry containing: survivorId, mergedFromIds[], reasoning string, preReshapeCommit, timestamp"
  - "Pre-reshape commit hash is captured once per reshape invocation (not once per merge) and is identical across all entries from that run"
  - "CLI output prints, for each merge: 'Merged <oldId> → <survivorId> — <reasoning>' and a single closing line showing the pre-reshape commit hash for rollback"
  - "Non-git working directories record preReshapeCommit: 'no-git' and reshape still completes successfully"
  - "Integration test runs reshape on a fixture with duplicate siblings, asserts archive.json contains the expected entries, and asserts the recorded commit matches `git rev-parse HEAD` taken before the command ran"
touches:
  - "6518b3be-eda4-4f06-9d78-1b592049ce4a"
priority: "high"
tags:
  - "rex"
  - "reshape"
  - "audit"
  - "prd-storage"
source: "smart-add"
---
