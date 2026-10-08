---
id: "47e43846-b305-4b39-bd0f-274efd72b0dc"
level: "task"
title: "Re-point recorded commit SHAs that a rebase or squash rewrote"
status: "pending"
priority: "high"
tags:
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
  - "host-neutral"
blockedBy:
  - "e50d9c97-8cf6-409b-b9bb-c6d00f832599"
source: "roadmap"
acceptanceCriteria:
  - "Fixtures for a rebased commit, a squash-merged branch, a cherry-pick and a never-merged commit each resolve to the right result and name the rule that matched (tests)"
  - "Without the host seam everything resolves from git alone; the seam is optional and off by default"
  - "Unmatched SHAs are returned with a reason, never dropped silently"
  - "No live network call in tests"
description: "Some SHAs stay stored: a change's appliedIn, and SHAs other tools record (hench run records, resolutions that cite a commit). When one is not reachable from main, find the commit it became, in this order: already on main; a twin with the same author email, author date and subject (a rebase keeps all three); the same patch-id; the same N-DX-Item trailer and subject; then, only through an optional injected host seam (for GitHub, the pull requests containing the commit), the merge commit of the PR that carried it. Return old to new with the rule that matched, and list the unmatched ones with a reason. This is a pure domain function plus the git reads it needs; wiring into `rex health` (warn, then offer the re-point) and a CLI command comes with PRs 16 and 18, and CI runs it after merges next to PR 22's stamp step. Measured on 2026-10-07: the PR 27/8 rebase is fully matched by author date and subject; 28 of the 33 off-main SHAs cited in the PRD were matched only through the host lookup (squash era); 5 were never merged.\n\nRescoped (2026-10-07, Ryan, pre-freeze review): v2 no longer stores appliedIn. PR 30 replaces it with appliedAt (a timestamp), and the apply commit is computed from the change's N-DX-Item trailer, so nothing in the v2 state needs re-pointing. This task's scope is the SHAs other tools still record: hench run records and resolutions that cite a commit. The matching rules, the optional host seam and the acceptance criteria stay as written, minus appliedIn."
lastModified: "2026-10-08T00:04:03.654Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
