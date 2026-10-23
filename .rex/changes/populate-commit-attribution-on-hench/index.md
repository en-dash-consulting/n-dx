---
id: "8956fb2a-6e3a-40f2-bc49-19fd641b4523"
type: "change"
title: "Populate commit attribution on hench-driven status transitions and from commit-message trailers"
slug: "populate-commit-attribution-on-hench"
intent: "When hench completes a task and embeds the existing N-DX status trailer in the commit message, also write the commit's full SHA, author name, and author email back into the PRD item's `commits` array as part of the same write transaction. Add a one-shot backfill command (`rex backfill-commit-attribution`) that walks recent git history, parses N-DX status trailers, and populates the `commits` field for items that completed before this feature shipped."
acceptanceCriteria:
  - "Hench post-commit hook updates the PRD item's `commits` array with the new commit's SHA, author, email, and timestamp"
  - "Update is appended (not overwritten) so multi-commit items accumulate attribution entries"
  - "Backfill command parses N-DX-Status trailers from `git log` and populates `commits` for matching items, idempotently"
  - "Backfill reports per-item results and skips items whose commits are already recorded"
  - "Integration test: complete a task via hench, assert commit SHA and author appear in the item's frontmatter"
  - "Unit test for backfill against a fixture git history"
touches:
  - "78798ece-882f-44c9-9996-6eec6e909989"
priority: "high"
tags:
  - "hench"
  - "rex"
  - "git"
source: "smart-add"
---
