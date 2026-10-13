---
id: "4965aeda-9cf7-4b84-bdd3-70123cbd412a"
level: "task"
title: "The Ask panel proposes v2 merges that the v1 rule allows and the v2 rule then refuses at apply"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-36"
  - "lane-web"
  - "review-2026-10-12"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 copy, parseAnswerRefinements given a merge that absorbs the fixture's amending change returns no merge proposal and a note carrying rex's 'carries amendments' reason (unit test)"
  - "On a v2 copy, a proposed merge of two tasks is skipped at parse time with rex's 'merges changes only' reason (unit test)"
  - "v1 parse-time merge proposals are unchanged; existing prd-refinement tests pass unedited"
description: "Found by the adversarial review of b0dbec5f (run 5c2458ab). Verdict: should-fix. It is a v2 UX gap, not a data defect.\n\nScenario: on a v2 project, the Ask panel in refine mode returns a merge that absorbs a change carrying amends, or that merges two tasks. parseAnswerRefinements → buildMerge (packages/web/src/server/prd-refinement.ts, around line 519) still checks with v1 validateMerge, so the proposal is offered with a previewMerge diff. That diff also omits the carried touches and aliases. The user accepts it, and POST /api/rex/apply-refinements reports it `invalid` with rex's v2 reason. Nothing is written wrongly, since apply now uses mergeChanges under the lock, but the user was offered something that could never apply.\n\nReachability: Ask panel → routes-sourcevision-ask.ts:747 parseAnswerRefinements(result.text, prdDoc), on a v2 project with the refine toggle.\n\nOptions:\n(a) Pass changeLayer into parseAnswerRefinements (the ask route can learn it from prdLayout(ctx.rexDir)) and have buildMerge use validateChangesMerge on v2, so a refused merge becomes a note like \"Skipped a merge of …: <rex reason>\". Cheap. The validateAgainst parameter already exists. Recommended.\n(b) Leave it: apply-time refusal is safe. It costs one wasted accept per bad proposal."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T17:00:26.797Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
