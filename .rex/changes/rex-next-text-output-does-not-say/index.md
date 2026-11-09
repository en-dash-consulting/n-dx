---
id: "d6efd604-6477-4d2c-b91b-a9194140783e"
type: "change"
title: "rex next text output does not say selection was narrowed to the branch's work set"
slug: "rex-next-text-output-does-not-say"
intent: "Scenario: on a feature branch with a work set (rex branch add), a low-priority task is assigned and a high-priority one is not. `rex next` (text output) prints the low task with \"Why: … selected at low priority\" and no line saying that selection was narrowed to the branch's work set or that --any widens it. The operator cannot tell why the high-priority task was passed over. JSON output carries workSetBranch; text output does not.\n\nEvidence: packages/rex/src/cli/commands/next.ts nextV2Work passes workSetBranch only through v2Fields, which printNext emits only under --format=json.\n\nReachable: every `rex next` on a work-set branch (introduced by task 5f9a638c). Not covered: e2e cli-next-work-set asserts JSON only.\n\nVerdict: should-fix (low) from ndx-adversarial-review. Fix options: (1) recommended: in printNext, when workSetBranch is set, info a line like \"  Work set: <branch> (--any picks outside it)\"; cost a few lines plus one e2e assertion. (2) fold the narrowing into explanation.summary; touches the shared explanation shape, more risk."
acceptanceCriteria:
  - "On a branch with a work set, `rex next` text output names the branch's work set and that --any picks outside it (e2e test)"
  - "`rex next` on the default branch or a branch with no assignment prints no work-set line (e2e test)"
touches:
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
priority: "low"
discoveredFrom: {"item":"5f9a638c-8663-441e-9cb2-4a90be03e274","run":"9087e390-1ff8-40fb-90f3-0bd7cf9ce064"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
