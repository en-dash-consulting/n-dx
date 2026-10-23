---
id: "71e079b5-bffc-4424-aa42-9ce682f7befc"
type: "change"
title: "Create shared test-only utility modules for duplicated setup code"
slug: "create-shared-test-only-utility"
intent: "Move the repeated constants and setup helpers identified during the audit into reusable test-only modules without changing any production files."
acceptanceCriteria:
  - "Repeated constants and helper functions identified in the audit are moved into shared test-only modules"
  - "Only test files and newly added test helper files are modified for this refactor"
touches:
  - "0fb7be48-74a2-495d-a184-dced4d6d2d87"
priority: "high"
tags:
  - "tests"
  - "unit"
  - "refactor"
  - "deduplication"
source: "smart-add"
parentId: "0fb7be48-74a2-495d-a184-dced4d6d2d87"
---
