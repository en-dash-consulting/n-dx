---
id: "95b81c0a-4d72-4b64-8bfc-9dc7f2609508"
level: "task"
title: "Queue offered review findings when the reviewer cannot ask the operator"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "pr-bg"
  - "hench"
  - "adversarial-review"
source: "PR M execution, 2026-09-24 (runs a32aeeb0, 8dc53406)"
acceptanceCriteria:
  - "After an attended run whose review offers a finding, `hench review pending <runId>` lists that finding."
  - "The reviewer is no longer told to wait for a selection it cannot receive."
  - "Autonomous-mode capture behaviour is unchanged."
description: "In an attended run (a TTY, no --yes), the review prompt tells the reviewer to \"offer to capture; capture only what the user selects\". The reviewer, though, is a headless `claude -p` session and cannot receive a selection. Findings end up `offered`, and `hench review pending <runId>` reports \"No deferred findings\", because only autonomous mode parks them in the pending-capture queue. They survive only in the run log. Runs a32aeeb0 (tuner units finding) and 8dc53406 (the `.n-dx.json` override finding) both lost offered findings this way. Either queue `offered` findings in attended mode too, or have hench present them to the operator after the review returns."
lastModified: "2026-09-24T20:30:06.548Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
