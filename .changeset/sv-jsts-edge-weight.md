---
"sourcevision": minor
---

Extend the reference-count edge-weight model to JS/TS imports. The resolver
now counts how many times each named-import binding actually appears in the
file body (after the import statement itself) and uses that as the edge
weight, capped at 10. Same hub-attraction problem the Swift resolver had: a
file that imports `cheap-helper` and uses it once shouldn't drag toward
`cheap-helper`'s zone as hard as a file that uses it 30 times. Wildcard and
default imports keep the baseline weight 1 because there's no parseable
local alias to count.
