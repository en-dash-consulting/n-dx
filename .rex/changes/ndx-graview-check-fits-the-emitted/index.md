---
id: "939e9e2b-bee0-4a23-b448-eba443a13455"
type: "change"
title: "ndx graview check fits the emitted snapshot to the declaration, not only the declaration"
slug: "ndx-graview-check-fits-the-emitted"
intent: "From the #647 review, point 1. `graview check` judges the declaration alone, so a record with an enum value the declaration lacks, or an edge to a kind the edge does not allow, passes `ndx graview check` and only fails at serve. The adapter's tests check that every node field is declared, but not enum values or edge targets, and nothing checks the real emitted pair."
acceptanceCriteria:
  - "`ndx graview check .` loads the emitted snapshot against the compiled declaration and fails, naming the record and field, on an undeclared enum value or an edge whose ends the declaration does not allow"
  - "A unit test emits a fixture project and asserts the pair fits"
  - "On the n-dx checkout the check passes"
touches:
  - "1fadb108-b5a8-405c-8699-bdba069663fc"
priority: "medium"
tags:
  - "graview"
source: "pr-review:#647"
---
