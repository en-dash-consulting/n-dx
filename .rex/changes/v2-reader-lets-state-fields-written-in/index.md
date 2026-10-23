---
id: "59847e62-38e0-48c2-a5ee-22d2163d410d"
type: "change"
title: "v2 reader lets state fields written in frontmatter (status, completedAt…) stand in for state.yaml"
slug: "v2-reader-lets-state-fields-written-in"
intent: "Failure: packages/rex/src/store/prd-model-reader.ts readNode (~line 315) merges `{ status: \"pending\", ...intent.data, ...stateRow }`. NodeIntentSchema is passthrough, so a v2 index.md that contains `status: \"completed\"` (hand-edited, or written by a buggy migration) but has no state.yaml row reads as completed. schema/v2.ts says an item absent from state.yaml reads as pending with no stamps. The same leak applies to every ItemState field (completedAt, prs, assignee…).\n\nReachability: none today, because loadPrdModel is wired to nothing. It becomes reachable when the v2 store or CLI consumes the model.\n\nVerdict: should-fix (adversarial review of task 12138fcd), medium.\n\nOptions:\n(a) Recommended, cheap. Before merging, strip keys in ItemStateSchema.shape from the intent and add a ParseWarning naming the key and file. State stays the only source of status.\n(b) Refuse the node: this is stricter, but one stray key would hide the whole node."
acceptanceCriteria:
  - "A v2 node whose frontmatter has status: completed and no state.yaml row loads with status pending (test)"
  - "Each state key found in frontmatter produces a warning naming the key and the file (test)"
  - "A state.yaml row still overrides nothing in intent and sets status as before (existing tests stay green)"
touches:
  - "16a680ad-40ec-43d6-a8ea-2eedbc3e0e77"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-09"
  - "rex"
source: "ndx-adversarial-review"
---
