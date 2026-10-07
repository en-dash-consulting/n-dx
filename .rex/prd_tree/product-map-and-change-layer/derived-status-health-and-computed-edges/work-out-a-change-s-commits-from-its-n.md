---
id: "e50d9c97-8cf6-409b-b9bb-c6d00f832599"
level: "task"
title: "Work out a change's commits from its N-DX-Item trailers instead of storing them"
status: "pending"
priority: "high"
tags:
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
  - "host-neutral"
source: "roadmap"
acceptanceCriteria:
  - "The v2 state schema has no commits field; a state.yaml that still carries commits loads, and the key is reported and ignored (test)"
  - "A fixture repository with trailer commits on a merged branch, a rebased copy and an unrelated commit returns exactly the change's commits reachable from main, for both trailer forms (test)"
  - "Computed commits are cached under .ndx/rex/.cache, gitignored and rebuilt when missing"
  - "No code path reads merge-commit message text other than the N-DX-Item trailer"
description: "Decision (2026-10-07): a commit's SHA is not its identity. GitHub's stack rebase rewrites SHAs (it did on 2026-10-07 for PRs 27, 8 and #548/#549), and before 2026-10-05 squash merges did, while the N-DX-Item trailer in the message survives both. So v2 does not store a change's commits. Remove `commits` (CommitAttribution) from the v2 state fields in packages/rex/src/schema/v2.ts and its zod schema; the state writer keeps unknown keys, so an old state.yaml that still has `commits` stays readable and the key is ignored with a warning. Compute them instead: the commits reachable from main (through merge commits, not first-parent only) whose N-DX-Item trailer names the item or one of its tasks, accepting both trailer forms (today's `<publicUrl>/#/rex/item/<id>` and the bare item id that PR 5 moves to). Cache the result under .ndx/rex/.cache (gitignored, rebuilt when missing). This task is the one exception to the rex-domain lane's no-schema-edit rule. Realized-by (task 97adaba2) and landing (task 52f22b65) read commits through this function. The migration does not copy v1 `commits` arrays into state.yaml; they are recomputable."
lastModified: "2026-10-07T21:28:27.736Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
