---
id: "3056614d-8ea2-4806-8ca5-1c5d0b770eca"
level: "task"
title: "Find out why narrate passes 2 and 3 leave no findings"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "enrich"
  - "findings"
source: "ndx-capture"
acceptanceCriteria:
  - "The cause is identified and recorded in the task log."
  - "If passes 2–3 findings are re-tagged or dropped, findings keep the pass that produced them and a test covers it."
description: "Retest of #743 with `sv analyze --narrate --target-pass=4`: of 82 findings, 66 are pass 0 and 16 are pass 4, none pass 2 or 3 (previous run 85/4, same split), despite 13 zone.enrich-scan and 15 zone.enrich-deep calls. Determine whether passes 2–3 produce nothing, or their findings are re-tagged or replaced by pass 4, and fix the attribution if it is the latter."
lastModified: "2026-10-15T02:21:01.090Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
