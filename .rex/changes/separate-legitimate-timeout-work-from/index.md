---
id: "c097f90b-722b-41b3-9777-492db05e50da"
type: "change"
title: "Separate legitimate timeout work from red-to-green defect fixes"
slug: "separate-legitimate-timeout-work-from"
intent: "Document which failures require implementation or configuration fixes and distinguish those from timeout guardrails so test edits are not used to hide real regressions."
acceptanceCriteria:
  - "No test file change is proposed solely to make an existing failing test pass"
  - "The diagnosis explicitly separates legitimate timeout additions from red-to-green production fixes"
touches:
  - "0fb7be48-74a2-495d-a184-dced4d6d2d87"
priority: "critical"
tags:
  - "tests"
  - "triage"
  - "regression"
  - "quality"
source: "smart-add"
parentId: "0fb7be48-74a2-495d-a184-dced4d6d2d87"
---
