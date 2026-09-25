---
id: "a133787f-0f8b-4823-bd9d-31e2c71b4908"
level: "task"
title: "Close out the 0.7.1 PRD bookkeeping before the cut"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "release-plumbing"
  - "pr-docs"
  - "audit-2026-09-23"
  - "non-code"
source: "0.7.1 re-plan 2026-09-23"
acceptanceCriteria:
  - "Every feature under the 0.7.1 epic whose children are all completed is itself completed."
  - "WM2090 and WM2092 carry a note naming the criteria main deliberately does not meet, and why: a single-task run gates twice; validate warns rather than fails on a missing marker; rex init does not write the marker."
  - "rex validate --post-merge reports no issue that needs manual intervention, and every Children table row matches its task file's status."
  - "WM2035 stays in_progress until the publish creates tags, and WM2054 and WM2055 stay open until after the publish."
  - "'Resolve hench review pending from the project's review directory' (c7585f76) is completed if PR C's review.ts change (#404) delivered it, or has a note saying what is left."
  - "Optional: the 142 repairable level-mismatch findings in pre-0.7.1 epics are repaired with `rex validate --post-merge --repair`, or left and noted as advisory."
description: "Final PRD sweep in the docs PR, after every code PR has merged. Some features end with every task completed but the feature itself still pending, because the PRs that carried their tasks each rebased over the others. Trust copy is the expected case, since H and I each leave the other's task open. Two completed tasks also carry criteria that main deliberately does not meet."
lastModified: "2026-09-24T20:31:12.424Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
