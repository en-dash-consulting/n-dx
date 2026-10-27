---
id: "7a0ed21e-ffe1-46a5-8110-728fd7e6e768"
type: "change"
title: "Implement root-cause fixes in production or configuration code"
slug: "implement-root-cause-fixes-in"
intent: "Apply fixes only in the application, CLI, configuration, or environment setup areas identified during diagnosis so failing tests are resolved at their actual source."
acceptanceCriteria:
  - "No test file is modified for the sole purpose of forcing previously failing tests to pass"
  - "Any production or config changes made to fix failures are limited to the actual root-cause areas identified during diagnosis"
touches:
  - "0fb7be48-74a2-495d-a184-dced4d6d2d87"
priority: "critical"
tags:
  - "tests"
  - "verification"
  - "ci"
  - "regression"
source: "smart-add"
parentId: "0fb7be48-74a2-495d-a184-dced4d6d2d87"
---
