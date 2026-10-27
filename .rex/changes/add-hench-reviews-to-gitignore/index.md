---
id: "4c732832-965a-4357-ae59-36790cc4106f"
type: "change"
title: "Add .hench/reviews/ to .gitignore"
slug: "add-hench-reviews-to-gitignore"
intent: ".gitignore covers .hench/runs/, .hench/locks/, and .hench/usage-cursors/ but not .hench/reviews/, the review-report transport directory introduced by the --review pass. The pre-run gate commit uses git add -A (shared.ts:1207), so a dirty tree at the start of the next run commits machine-local review reports to the repo."
acceptanceCriteria:
  - ".hench/reviews/ is listed in .gitignore"
  - "The ndx init ignore-list template includes it if that template exists"
amends: [{"target":"6eb227af-ffb2-4f39-8f62-d4afbad09a57","delta":"modified","summary":"Add .hench/reviews/ to .gitignore","base":"19a7255e7fea73685a43674ec0fb0de69a48cfd1b43ee6cde6d95994702e87f3"}]
priority: "low"
tags:
  - "hench"
  - "review-pass"
  - "git"
source: "ndx-work-e2e-verification"
---
