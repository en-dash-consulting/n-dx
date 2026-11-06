---
id: "bd562db4-2b29-49ba-afcb-9eacea8a5199"
type: "task"
title: "Tighten with Sidecar on \"tasks lack criteria\" opens Describe on a packet that never shows the tasks"
slug: "tighten-with-sidecar-on-tasks-lack"
description: "Verdict: should-fix (adversarial review of ab8a86e9).\n\nScenario: a change has its own done-when but two tasks with none, so Specs to tighten shows \"tasks lack criteria\". Its Tighten with Sidecar button (packages/web/src/viewer/views/spec-gaps.ts, changeId = first change with the task-criteria gap) attaches the change with the Describe lens. buildDescribePacket (packages/web/src/server/sidecar/packet-builders.ts:441-518) sends only the node's own text and acceptanceCriteria, its parent chain, blockers, resolve/preview and runs. No section lists the node's children, so the model never sees the tasks whose criteria are missing and cannot tighten them. It labels the change \"Task\" as well.\n\nReachable: Plan > Specs to tighten > the \"tasks lack criteria\" line > Tighten with Sidecar, with web.sidecar on. Not covered: describe-in-sidecar.test.ts only checks the client attachment.\n\nOptions:\n(1) Recommended. When the Describe target is a change, add a \"Tasks\" section with each child's title, status and done-when, and title the head section \"Change\". This is a server packet change plus one packet test. The section fits under DESCRIBE_CAP for typical changes; trim to N tasks if it does not.\n(2) Point the task-criteria line at the first task lacking criteria. ChangeSummary carries no task ids, so this needs a summary route change and still loses the change's context."
acceptanceCriteria:
  - "The Describe packet for a change lists each child task with its title, status and done-when checks"
  - "The Describe packet titles a change's head section Change, not Task"
  - "A sidecar packet test builds Describe on a change with a criteria-less task and asserts the task appears in the packet"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
