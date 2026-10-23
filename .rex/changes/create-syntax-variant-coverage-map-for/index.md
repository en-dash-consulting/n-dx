---
id: "7e41ce28-7691-4211-8b95-a325919bdb6b"
type: "change"
title: "Create syntax variant coverage map for the Go fixture"
slug: "create-syntax-variant-coverage-map-for"
intent: "Audit the enhanced fixture against all import syntax variants that go-imports.ts must handle. For each supported variant (single, grouped, aliased, blank, dot, test file imports), identify which fixture file demonstrates it. Add a coverage comment to go-imports.test.ts or a FIXTURE.md file in the fixture directory mapping each file to the variant(s) it exercises. Document any intentionally absent variant with a rationale."
acceptanceCriteria:
  - "All five import syntax variants (single, grouped, aliased, blank, dot) map to at least one fixture file in the coverage map"
  - "A coverage comment in go-imports.test.ts or a FIXTURE.md file lists the file→variant mapping"
  - "Any intentionally absent variant is documented with a rationale rather than silently omitted"
  - "The coverage map is accurate after the preceding fixture-addition task completes"
  - "No variant listed in the go-imports.ts spec is silently uncovered"
touches:
  - "41a438d4-def7-4e85-ac41-e7b023184764"
priority: "high"
tags:
  - "go"
  - "sourcevision"
  - "fixtures"
  - "documentation"
source: "smart-add"
---
