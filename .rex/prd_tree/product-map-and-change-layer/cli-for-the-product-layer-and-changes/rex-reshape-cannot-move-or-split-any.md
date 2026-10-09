---
id: "1413100d-f891-4313-b27a-bdbd6107ae6f"
level: "task"
title: "rex reshape cannot move or split any product node that a change has ever touched, because apply's History line counts as \"a body\""
status: "in_progress"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-18"
  - "rex"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T15:42:41.742Z"
acceptanceCriteria:
  - "draftProductReshape drafts a reparent of a capability whose body contains only a History section (test)"
  - "A capability with notes outside History is still skipped with the reason (test)"
  - "Applying the drafted move from a node created by rex change apply succeeds end to end (integration test)"
description: "Verdict: should-fix (found reviewing 25a733b4).\n\nScenario: applying a change appends a History line to the body of every node it adds or amends (packages/rex/src/core/apply-amendments.ts:129; product-edit.ts:123 does the same for an editorial edit). product-reshape.ts cannotCopy skips a reparent or split of any node with a non-empty body, so the skip also catches a capability whose body is nothing but that History section. That covers any capability created through `rex change apply`, including the copy made by an earlier reshape move. In practice, `rex reshape --accept` cannot move or split most nodes in a live v2 tree. It prints \"has a body, which an added copy would drop\".\n\nReachable: `rex change apply` (adds or amends a node), then `rex reshape --accept` with a reparent or split proposal for that node.\n\nThe History is not destroyed: the retired original keeps its file and History, and the copy starts its own. Only notes outside History would really be lost.\n\nOptions:\n(1) Treat a body that holds only the History section as copyable. The copy's History could add a line naming the original. This is cheap: parse the body with the same section logic as appendHistory. Risk: notes written under the History heading would not be copied.\n(2) Carry the body through the added amendment (needs an apply-engine and schema decision, as with requirements/dependsOn in 25a733b4 option 2).\nDecision for Ryan: the 25a733b4 decision listed \"a body\" without separating the History section from notes. Recommend (1).\n\nDecided (Ryan, 2026-10-09): option 1. A body holding only the History section is copyable; the copy's History may add a line naming the original. Notes outside History still skip the move with the reason. Do not carry the body through the added amendment (option 2)."
lastModified: "2026-10-09T15:42:42.002Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
