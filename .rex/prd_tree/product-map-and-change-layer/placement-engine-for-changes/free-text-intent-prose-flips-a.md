---
id: "4d097853-07ec-4b66-966e-8149f155bf18"
level: "task"
title: "Free-text intent prose flips a placement's relation to amends"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A change titled \"Rename the lock helper\" with intent mentioning \"the new store layout\" gets relation \"touches\""
  - "\"Do not add retries\" is not classified as amends"
  - "\"Add token rotation\" still gets relation \"amends\""
  - "Tests cover each case in packages/rex/tests/unit/core/placement.test.ts"
description: "Verdict: should-fix (medium). Found by the adversarial review of 2fa34877.\n\nScenario: `placementRelation` (packages/rex/src/core/placement.ts, the NEW_BEHAVIOUR regex) matches anywhere in the title or the intent. Intent is a paragraph about why the change exists, so ordinary prose trips it. Examples:\n- A refactor titled \"Rename the lock helper\" with intent \"the new store layout makes the old name misleading\" becomes `amends`.\n- \"Do not add retries to the hub\" also becomes `amends`.\n\nUnder `autoAccept: agree` the accepted placement then claims to amend a capability's requirements, which feeds the apply engine and change kind.\n\nReachability: no caller yet; live once place_change ships (PR 17).\n\nOptions:\n1. Match only an imperative leading verb in the title, plus an explicit marker in the intent. Cheap, fewer false amends, may miss some real features. Recommended.\n2. Let the text model suggest the relation as advisory only, with the rules still deciding when the two disagree. More cost and a seam change."
lastModified: "2026-10-08T04:41:14.083Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
