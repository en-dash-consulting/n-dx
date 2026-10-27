---
id: "58d4e31f-c91b-4ba3-8559-a78a5e6f8350"
type: "capability"
title: "Cross-Package Duplicate Logic Consolidation"
slug: "cross-package-duplicate-logic"
statement: "n-dx keeps each shared utility function in one module at the right tier of its dependency hierarchy. Consumers in other packages import that function through their gateway module and do not keep their own copies."
criteria: [{"id":"c1","text":"The codebase shall keep each functionally identical function body in no more than one package's production source."},{"id":"c2","text":"The codebase shall place each consolidated utility function in the module that the four-tier dependency hierarchy (Foundation, Domain, Execution, Orchestration) makes appropriate for it."},{"id":"c3","text":"When a package uses a consolidated utility function from another package, the consuming code shall import it from its canonical location through that package's gateway module."},{"id":"c4","text":"Each package's test suite shall keep each test helper function body in no more than one test file within that package."},{"id":"c5","text":"When test files in a package share helper functions, fixture builders or mock setup, those test files shall import them from that package's single shared test utility module."}]
source: "smart-add"
---

Locate functionally identical or near-identical utility functions copy-pasted across packages and consolidate them into the tier-appropriate shared module following the four-tier dependency hierarchy in CLAUDE.md. Reduces maintenance surface and eliminates redundant lines without changing behavior.
