---
id: "d587adc9-56f3-4141-8ec8-4b0483758741"
type: "change"
title: "Add structure health gate to rex ci / ndx ci"
slug: "add-structure-health-gate-to-rex-ci"
intent: "Add the structure health check as a CI gate in rex ci. When thresholds are exceeded, the CI check fails with a clear message listing which thresholds were crossed. This catches structural drift in automated pipelines."
acceptanceCriteria:
  - "ndx ci fails when structure thresholds are exceeded"
  - "CI JSON output includes structure health results"
  - "Threshold violations listed with specific counts vs limits"
  - "Passes cleanly when structure is healthy"
amends: [{"target":"f0294876-d42d-497e-a3c6-c5abf7a374ed","delta":"modified","summary":"Add structure health gate to rex ci / ndx ci","base":"64dbbc9b61e13902418f831f744c890674e5efbe99ba153342cdf7897343fb50"}]
priority: "medium"
tags:
  - "rex"
  - "ci"
blockedBy:
  - "bf1fd080-e3f7-4af9-8ee3-1626df8da8d7"
---
