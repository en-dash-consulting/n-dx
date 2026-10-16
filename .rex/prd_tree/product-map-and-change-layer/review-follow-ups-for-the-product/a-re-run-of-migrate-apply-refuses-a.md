---
id: "85a02c2f-0326-4063-9d48-8f55febce2fa"
level: "task"
title: "A re-run of migrate --apply refuses a genuine leftover prd_tree/ that the plan cannot vouch for"
status: "pending"
priority: "low"
tags:
  - "lane-migration"
  - "rex"
  - "v2-migrate-l7"
source: "adversarial review of run 88f37efa (deferred)"
acceptanceCriteria:
  - "The refusal names the leftover path and the safe manual step (or flag) to clear it"
  - "A test covers a partly removed prd_tree/ on a v2 tree"
description: "Deferred by the adversarial review of 1dc03bda (run 88f37efa, 2026-10-15), captured by the overnight session. Since 1dc03bda, apply on an already-v2 tree removes a leftover prd_tree/ only when an interrupted apply provably left it. A partly removed prd_tree/, or one from an apply run against a tree edited after the plan, is refused instead. That fails closed (nothing is deleted), so it is not a cut blocker, but the operator then has no documented way forward. Smallest fix: the refusal names the leftover and says how to remove it by hand after checking it, or offers a flag that removes it after confirming the v2 tree is complete."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T19:37:15.586Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
