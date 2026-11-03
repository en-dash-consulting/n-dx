---
"@n-dx/rex": patch
---

Add `computeAreaLinks`, a computed area-to-area edge (no schema field): `coChanges` counts the distinct changes that amend or touch a capability in both areas, and `sharedTests` lists the test files capabilities in both areas run. The v1→v2 migration plan proposes `dependsOn` between capabilities whose specs link the same test file, skipping a test linked by more than three capabilities; the plan summary counts the proposals (`proposedDependsOn`) and the review Markdown lists them under "Proposed dependsOn".
