---
id: "d4c9c5a6-01ee-43e6-ab1d-e4eb02cefdaf"
type: "change"
title: "Wave 1 review round 2: bound auth re-checks without a billed call per visit"
slug: "wave-1-review-round-2-bound-auth-re"
summary: "Robot Wrangler now runs a billed vendor auth check on almost every visit because cached verdicts expire after a minute, and one isolation test cannot fail. Fix both before outside review."
intent: "Round-2 review of PR #1003 (head 4d221310d). Follows the completed round-1 change b2f8cfa9-a4c8-42bb-909f-e51db395362f. Fix before requesting outside review. Land on feat/stack-review-followups with the code in an atomic code/PRD commit."
acceptanceCriteria:
  - "Both round-2 review tasks are complete on PR #1003's own branch."
touches:
  - "07e4564e-e181-42c1-be5a-20a16c8d2649"
priority: "high"
source: "ndx-capture"
---
