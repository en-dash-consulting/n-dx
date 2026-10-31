---
id: "462b236f-b444-4b62-bbaf-1a76c1c42370"
type: "change"
title: "Validate release suites in parallel jobs before publishing"
slug: "validate-release-suites-in-parallel"
intent: "The Release workflow runs all package test workers on a single runner under the publishing job's deadline. Split validation into the existing CI suite groups on independent read-only runners; require every group to succeed before release creation or publishing. Preserve built-grammar enforcement, publishing assets, full-history stamping, and standalone validate-oidc dispatch."
acceptanceCriteria:
  - "Every root and package test suite runs once across independent release validation groups using the sequential suite runner."
  - "Publishing waits for all validation groups and stays blocked on failed, cancelled or skipped validation."
  - "Grammar-dependent validation groups build grammars and require them; publishing still builds all shipped grammar assets."
  - "The validate-oidc dispatch runs its probe without validation or publishing."
touches:
  - "4d39b5b0-fd9d-45ad-a510-30551d185556"
priority: "high"
source: "user"
---
