---
id: "d9423de2-7973-44c0-b5ab-27c71f79ec6d"
type: "change"
title: "Run records keep each commit's author date and subject, and re-point rewritten SHAs"
slug: "run-records-keep-each-commit-s-author"
intent: "Hench run records (.hench/runs, machine-local and gitignored) store commit SHAs (sha, repairCommit, startHead). A GitHub stack rebase rewrites them: on 2026-10-07 every commit cited in the PR 27/8 and #548/#549 run records stopped being on main. Record each commit's author date and subject next to its SHA, and add a local re-point that uses rex's re-point function (roadmap PR 11) to map rewritten SHAs to their twins on main; records that cannot be re-pointed say so. Outside the 1.0.0 roadmap; lands after PR 11."
acceptanceCriteria:
  - "A new run record stores author date and subject next to every commit SHA it records"
  - "A local re-point maps a run record's rewritten SHAs to their twins on main through rex's re-point function, and marks the ones it cannot match (test with a rebased fixture)"
  - "Run records written before this change are still readable"
priority: "medium"
tags:
  - "hench"
  - "run-records"
  - "host-neutral"
source: "hub"
blockedBy:
  - "47e43846-b305-4b39-bd0f-274efd72b0dc"
---
