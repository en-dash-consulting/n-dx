---
id: "41bc75d8-637e-4336-853c-7bfb9b41ddfa"
type: "change"
title: "Write Spec-Driven Development Guide"
slug: "write-spec-driven-development-guide"
intent: "Document how to drive development from a written specification or requirements document using n-dx. Covers importing a spec file into rex (`ndx add --file=spec.md`), reviewing and shaping the generated PRD hierarchy, locking in scope with `ndx plan --accept`, and executing the plan autonomously with `ndx work`. Includes guidance on iterating the spec as requirements evolve and keeping the PRD as the source of truth."
acceptanceCriteria:
  - "Guide covers the full spec-to-execution path: spec file → `ndx add --file` import → proposal review → `ndx plan --accept` → `ndx work`"
  - "Guide explains how to review and reshape the imported PRD before accepting — including priority ordering and LoE estimation"
  - "Guide includes a section on updating the spec mid-flight: how to add new items without duplicating existing PRD structure"
  - "Guide shows how to use `ndx status` and the dashboard to track spec coverage as tasks complete"
  - "A developer can follow the guide to go from a markdown spec to an executing autonomous agent in one session"
touches:
  - "32799258-d738-428d-8d6f-8a5bfacfb12a"
priority: "high"
tags:
  - "docs"
  - "rex"
  - "spec-driven"
source: "smart-add"
---
