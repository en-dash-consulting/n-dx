---
id: "4fc2d793-dbd7-4544-acf7-44131221b26c"
level: "task"
title: "An amendment's type is accepted on any delta and may be missing on an added one"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T00:32:22.776Z"
completedAt: "2026-10-08T00:32:22.776Z"
endedAt: "2026-10-08T00:32:22.776Z"
resolutionType: "code-change"
resolutionDetail: "Resolved by ba39230d item 7: amendment-type rule errors on a type carried by a modified or removed amendment; an added amendment without type defaults to capability and is not reported (Ryan's decision), with fixtures for both cases."
acceptanceCriteria:
  - "checkV2Rules reports an added amendment with no type (severity per the decision)"
  - "checkV2Rules warns on a type carried by a modified or removed amendment"
  - "tests/unit/schema/v2-rules.test.ts has fixtures for both cases and for a well-formed added amendment that produces no finding"
description: "Verdict: should-fix (low), from the adversarial review of 616f908a.\n\nScenario: AmendmentSchema (packages/rex/src/schema/v2.ts, Amendment.type) accepts `{ delta: \"modified\", type: \"constraint\" }` and `{ delta: \"added\" }` with no type. No rule in v2-rules.ts reports either case. The doc comment says `type` is for added only and decides the derived kind (policy change vs feature). So apply (PR 10) and derived kind (PR 11) each have to guess what an added amendment with no type creates, and a stray type on a modified or removed amendment is silently ignored.\n\nReachable: through any authored change frontmatter once the v2 store is wired. Not reachable today because v2 is unwired.\n\nOptions:\n(a) Add a v2 rule: an added amendment without type is an error (or a warning that defaults to capability), and a type on a modified or removed amendment is a warning. Cheap: one rule plus tests. This is the recommended option.\n(b) Use a Zod refinement on AmendmentSchema. Rejected: a refinement fails the whole node and refuses writes, which the schema's loose-intent policy avoids.\n\nDecision for Ryan: should a missing type on an added amendment default to capability (warning) or be an error?"
lastModified: "2026-10-08T00:32:23.352Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
