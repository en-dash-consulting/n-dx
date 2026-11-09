---
id: "2aaad024-a98a-42c7-9b94-ca5e43e66ceb"
type: "task"
title: "A failed rm of the leftover v1 files on an already-v2 apply throws the raw error without saying the v2 tree is in place"
slug: "a-failed-rm-of-the-leftover-v1-files"
description: "Adversarial review of 6139ac49, out-of-scope (pre-existing, from 1dc03bda), low.\n\npackages/rex/src/migrations/v1-to-v2/apply.ts applyV1ToV2, already-v2 branch: `for (const path of leftover.removed) await rm(path, …)` has no catch. This is exactly the re-run that removeAfterSwitch now tells the user to make. If the same held handle (dashboard watcher, antivirus on Windows) is still there, the re-run throws a raw EBUSY/EPERM with a stack (asCliError rethrows non-MigrationApplyError), with no hint that the v2 tree is fine and a later re-run will finish.\n\nReachable: `ndx migrate --apply` on a v2 tree with leftovers on Windows while a handle is held. Message-only gap; no data at risk.\n\nFix (recommended): route that loop through removeAfterSwitch (rename it to something like removeV1Leftovers) so both paths report the same message. Cost: a few lines plus one test using the existing fsFaults.failRm mock in apply.test.ts."
acceptanceCriteria:
  - "With rm of the leftover prd_tree/ made to fail during an apply on an already-v2 tree, apply throws MigrationApplyError saying the v2 tree is in place, naming the leftover and the underlying error (test)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lane-migration"
  - "v2-migrate-l7"
source: "ndx-adversarial-review"
---
