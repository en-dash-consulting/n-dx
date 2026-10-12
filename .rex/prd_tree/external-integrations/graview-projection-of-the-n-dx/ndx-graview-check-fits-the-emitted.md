---
id: "939e9e2b-bee0-4a23-b448-eba443a13455"
level: "task"
title: "ndx graview check fits the emitted snapshot to the declaration, not only the declaration"
status: "pending"
priority: "medium"
tags:
  - "graview"
source: "pr-review:#647"
acceptanceCriteria:
  - "`ndx graview check .` loads the emitted snapshot against the compiled declaration and fails, naming the record and field, on an undeclared enum value or an edge whose ends the declaration does not allow"
  - "A unit test emits a fixture project and asserts the pair fits"
  - "On the n-dx checkout the check passes"
description: "From the #647 review, point 1. `graview check` judges the declaration alone, so a record with an enum value the declaration lacks, or an edge to a kind the edge does not allow, passes `ndx graview check` and only fails at serve. The adapter's tests check that every node field is declared, but not enum values or edge targets, and nothing checks the real emitted pair."
lastModified: "2026-10-12T20:19:17.689Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
