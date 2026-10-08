---
id: "d6051f7d-9a41-4374-8669-a588fa827671"
level: "task"
title: "A change that adds the same target twice passes the v2 rules, hiding a self-parent on the duplicate"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T01:14:55.511Z"
completedAt: "2026-10-08T01:14:55.511Z"
endedAt: "2026-10-08T01:14:55.511Z"
acceptanceCriteria:
  - "checkV2Rules reports an error when one change carries two added amendments with the same target, naming the change and the target"
  - "A unit test in tests/unit/schema/v2-rules.test.ts covers the duplicate-with-self-parent case [{target x}, {target x, under x}] and fails on the code before the fix"
description: "Found by the adversarial review of task 494ec070. Verdict: should-fix. It is not reachable through the CLI, because v2 files are wired to nothing yet. It becomes reachable once the v2 loader and the apply engine read hand-edited changes.\n\nScenario: a change's amends are [{target x, added}, {target x, added, under x}]. checkV2Rules returns no ref-resolves finding (verified against dist). The cause is in refResolves (packages/rex/src/schema/v2-rules.ts): the `added` map keeps the first amendment per target, so sameChangeTree walks only that one. The duplicate is never in `placed`, so its under is neither walked nor kind-checked. No rule reports two added amendments with the same target, and ref-unique checks only node ids.\n\nOptions:\n(a) Recommended. Report a duplicate added target in one change as an error, and keep the first-wins map. This costs one loop and one test, and the risk is low.\n(b) Walk every added amendment rather than map values. This alone still misreads the duplicate's parent as the first amendment, so it is not enough.\n\nDecision (2026-10-07, Ryan): option (a), in PR 30: report a duplicate added target in one change as an error and keep the first-wins map. Done in the same run as 2f000cd0."
lastModified: "2026-10-08T01:14:55.764Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
