---
id: "cf78aa03-deb6-44b0-bc79-f1fb5c30b891"
type: "change"
title: "Group failing suites by shared production-side root cause"
slug: "group-failing-suites-by-shared"
intent: "Analyze current failures and cluster them by the underlying application, CLI, configuration, or architectural issue rather than by individual failing assertions."
acceptanceCriteria:
  - "Current failures are grouped by root cause rather than by individual assertion"
  - "Each failure group clearly identifies whether the fix belongs in application code, configuration, or environment setup"
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
