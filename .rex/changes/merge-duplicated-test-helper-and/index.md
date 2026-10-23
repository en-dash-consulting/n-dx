---
id: "484812ac-4ed8-4cfd-ae52-20509e3200fb"
type: "change"
title: "Merge duplicated test helper and fixture factories into per-package shared test utilities"
slug: "merge-duplicated-test-helper-and"
intent: "Audit test files within each package for helper functions, fixture builders, and mock setup blocks that are copy-pasted across multiple test files in the same package. Consolidate confirmed duplicates into a discoverable shared test utility module per package (e.g., tests/helpers/index.ts). Update all consumers to import from the shared module. This does not modify test assertions or production logic."
acceptanceCriteria:
  - "No test helper function body is copy-pasted across more than one test file within the same package"
  - "Each package with duplicated helpers has a single shared test utility module that all consumers import from"
  - "pnpm test passes with identical pass/fail counts after consolidation"
  - "Net reduction in test code size is at least 80 lines across all packages"
touches:
  - "58d4e31f-c91b-4ba3-8559-a78a5e6f8350"
priority: "medium"
tags:
  - "deduplication"
  - "testing"
  - "cleanup"
source: "smart-add"
---
