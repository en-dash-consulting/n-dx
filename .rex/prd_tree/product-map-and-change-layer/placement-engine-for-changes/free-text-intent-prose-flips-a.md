---
id: "4d097853-07ec-4b66-966e-8149f155bf18"
level: "task"
title: "Free-text intent prose flips a placement's relation to amends"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T05:17:06.648Z"
completedAt: "2026-10-08T05:17:06.648Z"
endedAt: "2026-10-08T05:17:06.648Z"
resolutionType: "code-change"
resolutionDetail: "Closed by 127a68ab: placementRelation is title-led with an explicit Relation line winning; intent prose never decides. Tests cover the rename/new-layout, 'Do not add retries' and 'Add token rotation' cases."
acceptanceCriteria:
  - "A change titled \"Rename the lock helper\" with intent mentioning \"the new store layout\" gets relation \"touches\""
  - "\"Do not add retries\" is not classified as amends"
  - "\"Add token rotation\" still gets relation \"amends\""
  - "Tests cover each case in packages/rex/tests/unit/core/placement.test.ts"
description: "Verdict: should-fix (medium). Found by the adversarial review of 2fa34877.\n\nScenario: `placementRelation` (packages/rex/src/core/placement.ts, the NEW_BEHAVIOUR regex) matches anywhere in the title or the intent. Intent is a paragraph about why the change exists, so ordinary prose trips it. Examples:\n- A refactor titled \"Rename the lock helper\" with intent \"the new store layout makes the old name misleading\" becomes `amends`.\n- \"Do not add retries to the hub\" also becomes `amends`.\n\nUnder `autoAccept: agree` the accepted placement then claims to amend a capability's requirements, which feeds the apply engine and change kind.\n\nReachability: no caller yet; live once place_change ships (PR 17).\n\nOptions:\n1. Match only an imperative leading verb in the title, plus an explicit marker in the intent. Cheap, fewer false amends, may miss some real features. Recommended.\n2. Let the text model suggest the relation as advisory only, with the rules still deciding when the two disagree. More cost and a seam change.\n\nDecision (2026-10-08, Ryan): option 1, title-led relation. Done in task dd0b540e.\n\nFollow-up (2026-10-08): dd0b540e implemented the verb AND the marker, so every change placed as touches. Corrected by the task 'Place as amends on an amending title verb or an explicit Relation marker': either signal, the explicit line winning."
lastModified: "2026-10-08T05:17:06.914Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
