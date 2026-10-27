---
id: "b5a89672-4d03-4f4e-9a79-f529ba7ffe0a"
type: "task"
title: "Capability \"Dashboard renders a v2 project\" criterion c8 still says a v2 POST /api/rex/items with a parent answers 400"
slug: "capability-dashboard-renders-a-v2"
description: "Since 4cda49b51 the route adds a task under a change (and a subtask under a task) on v2. Criterion c8 of capability e1a26302 (\"If POST /api/rex/items on a v2 project carries a parentId, the server shall answer 400 ...\") now states the opposite of the code, and the change only touches the capability, so applying it will not correct the spec. A steward reading the capability, or a spec review, acts on a false rule. Verdict should-fix (low): spec drift, no runtime failure. Option (recommended): give this change an amendment (modified) on e1a26302 replacing c8 with \"When POST /api/rex/items on a v2 project carries a parentId naming a change, the server shall add a task under it through rex's add rule; a closed change is refused with rex's reason\", and drop the touch."
acceptanceCriteria:
  - "The capability's criteria no longer say a v2 POST with a parent answers 400"
  - "A criterion states that a v2 POST with a change parent adds a task through rex, and a closed change is refused"
  - "The change carries the amendment, so applying it updates product/"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
