---
id: "85a02c2f-0326-4063-9d48-8f55febce2fa"
type: "task"
title: "A re-run of migrate --apply refuses a genuine leftover prd_tree/ that the plan cannot vouch for"
slug: "a-re-run-of-migrate-apply-refuses-a"
description: "Deferred by the adversarial review of 1dc03bda (run 88f37efa, 2026-10-15), captured by the overnight session. Since 1dc03bda, apply on an already-v2 tree removes a leftover prd_tree/ only when an interrupted apply provably left it. A partly removed prd_tree/, or one from an apply run against a tree edited after the plan, is refused instead. That fails closed (nothing is deleted), so it is not a cut blocker, but the operator then has no documented way forward. Smallest fix: the refusal names the leftover and says how to remove it by hand after checking it, or offers a flag that removes it after confirming the v2 tree is complete.\n\nFolds a17ddff8 and 2aaad024 (session triage, 2026-10-16, from the review of 6139ac49). Keep it simple, per Ryan's rule for v1 migration: no fingerprint comparison to auto-accept a partial leftover (a17ddff8's option 1). Instead every leftover-removal path says the same true thing. (1) When removeAfterSwitch fails partway after the switch, its message must not promise that a re-run with the plan finishes the job: it names the leftover paths and the safe manual step, which is the same step the refusal below gives. (2) The already-v2 branch's leftover rm loop goes through the same reporting, so a failed rm there says the v2 tree is in place, names the leftover and the error, instead of a raw EBUSY/EPERM. (3) The refusal for a leftover the plan cannot vouch for names the path and the safe manual step."
acceptanceCriteria:
  - "The refusal for a leftover prd_tree/ the plan cannot vouch for names the leftover path and the safe manual step to clear it (test)"
  - "A test covers a partly removed prd_tree/ on a v2 tree: the re-run refuses with that message and deletes nothing"
  - "removeAfterSwitch's partial-failure message names the leftover paths and the same manual step, and no longer says a re-run with the plan removes them (test)"
  - "On an already-v2 apply, a failed rm of a leftover throws MigrationApplyError saying the v2 tree is in place, naming the leftover and the underlying error (test with fsFaults.failRm)"
  - "A prd_tree/ beside the v2 tree that holds an item edited after the plan is still refused (existing test keeps passing)"
priority: "low"
tags:
  - "lane-migration"
  - "rex"
  - "v2-migrate-l7"
source: "adversarial review of run 88f37efa (deferred)"
---
